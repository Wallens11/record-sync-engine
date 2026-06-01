/**
 * POST /api/webhooks/source
 *
 * Receives Record source webhook events and routes them to the correct adapter
 * based on the sync rule's destination.type:
 *
 *   zendesk  → resolve user by custom field → update user_fields → optional write-back
 *   hubspot  → resolve contact by property  → update properties  → optional write-back
 *   slack    → build Block Kit message      → post to channel
 *
 * Auth: token in ?token= query param or X-Webhook-Token header.
 * Deduplication: in-memory set keyed by collectionId:recordId:eventType (resets on cold start).
 */
import { NextRequest, NextResponse } from "next/server"
import { getRuleForCollection } from "@/src/lib/sync-rules"
import { getRecord, getFieldValue, updateRecord, type SourceRecord } from "@/src/lib/record-source"
import { resolveUserByCustomField, updateUserFields } from "@/src/adapters/zendesk"
import { resolveContactByProperty, updateContactProperties } from "@/src/adapters/hubspot"
import { postSlackMessage } from "@/src/adapters/slack"

// In-memory dedupe (resets on cold start — acceptable for low-volume webhooks)
const processed = new Set<string>()

export async function POST(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const token =
    req.nextUrl.searchParams.get("token") ??
    req.headers.get("x-webhook-token")

  if (token !== process.env.SOURCE_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  const body = await req.json()
  const collectionId = String(body?.collectionId ?? body?.collection?.id ?? "")
  const recordId = String(body?.recordId ?? body?.record?.id ?? body?.record?.["$id"]?.value ?? "")
  const eventType = String(body?.type ?? "UNKNOWN")

  // ── 3. Dedupe ──────────────────────────────────────────────────────────────
  const dedupeKey = `${collectionId}:${recordId}:${eventType}:${Date.now()}`
  if (processed.has(dedupeKey)) {
    return NextResponse.json({ status: "duplicate", skipped: true })
  }
  processed.add(dedupeKey)
  // Trim set to avoid unbounded growth
  if (processed.size > 1000) {
    const first = processed.values().next().value
    if (first) processed.delete(first)
  }

  // ── 4. Load sync rule ──────────────────────────────────────────────────────
  const rule = getRuleForCollection(collectionId)
  if (!rule) {
    return NextResponse.json({ status: "no-rule", collectionId })
  }

  try {
    // ── 5. Fetch source record ──────────────────────────────────────────────
    const record = await getRecord(collectionId, recordId)

    // ── 6. Route to adapter ────────────────────────────────────────────────
    switch (rule.destination.type) {
      case "zendesk":
        return await handleZendesk(collectionId, recordId, record, rule)

      case "hubspot":
        return await handleHubSpot(collectionId, recordId, record, rule)

      case "slack":
        return await handleSlack(collectionId, recordId, record, rule)

      default:
        return NextResponse.json(
          { status: "error", message: `Unknown destination type: ${(rule as { destination: { type: string } }).destination.type}` },
          { status: 400 }
        )
    }
  } catch (err) {
    console.error("[webhook] Sync error:", err)
    return NextResponse.json(
      { status: "error", message: String(err) },
      { status: 500 }
    )
  }
}

// ─── Zendesk handler ──────────────────────────────────────────────────────────

async function handleZendesk(
  collectionId: string,
  recordId: string,
  record: SourceRecord,
  rule: ReturnType<typeof getRuleForCollection> & object
) {
  if (!rule) return NextResponse.json({ status: "no-rule" })
  const lookupValue = getFieldValue(record, rule.source.lookupFieldCode)
  if (!lookupValue) {
    return NextResponse.json({ status: "unresolved", reason: "empty lookup value" })
  }

  const overrideValue = rule.writeBack?.userIdField
    ? getFieldValue(record, rule.writeBack.userIdField)
    : ""

  let userId: number | null = null
  let userUrl: string | null = null
  let source = "not-found"

  if (overrideValue) {
    userId = Number(overrideValue)
    source = "override"
  } else {
    const resolved = await resolveUserByCustomField(rule.destination.lookupFieldKey, lookupValue)
    userId = resolved.userId
    userUrl = resolved.userUrl
    source = resolved.source
  }

  if (!userId) {
    return NextResponse.json({ status: "unresolved", source, lookupValue })
  }

  const fields = buildFieldMap(record, rule.fieldMapping)
  await updateUserFields(userId, fields)

  await maybeWriteBack(collectionId, recordId, rule, String(userId), userUrl, !!overrideValue)

  return NextResponse.json({
    status: "processed",
    adapter: "zendesk",
    collectionId, recordId,
    destinationId: userId,
    source,
    updatedFields: Object.keys(fields),
  })
}

// ─── HubSpot handler ──────────────────────────────────────────────────────────

async function handleHubSpot(
  collectionId: string,
  recordId: string,
  record: SourceRecord,
  rule: ReturnType<typeof getRuleForCollection> & object
) {
  if (!rule) return NextResponse.json({ status: "no-rule" })
  const lookupValue = getFieldValue(record, rule.source.lookupFieldCode)
  if (!lookupValue) {
    return NextResponse.json({ status: "unresolved", reason: "empty lookup value" })
  }

  const overrideValue = rule.writeBack?.userIdField
    ? getFieldValue(record, rule.writeBack.userIdField)
    : ""

  let contactId: string | null = null
  let contactUrl: string | null = null
  let source = "not-found"

  if (overrideValue) {
    contactId = overrideValue
    source = "override"
  } else {
    const resolved = await resolveContactByProperty(rule.destination.lookupFieldKey, lookupValue)
    contactId = resolved.contactId
    contactUrl = resolved.contactUrl
    source = resolved.source
  }

  if (!contactId) {
    return NextResponse.json({ status: "unresolved", source, lookupValue })
  }

  const properties = buildFieldMap(record, rule.fieldMapping)
  await updateContactProperties(contactId, properties)

  await maybeWriteBack(collectionId, recordId, rule, contactId, contactUrl, !!overrideValue)

  return NextResponse.json({
    status: "processed",
    adapter: "hubspot",
    collectionId, recordId,
    destinationId: contactId,
    source,
    updatedFields: Object.keys(properties),
  })
}

// ─── Slack handler ────────────────────────────────────────────────────────────

async function handleSlack(
  collectionId: string,
  recordId: string,
  record: SourceRecord,
  rule: ReturnType<typeof getRuleForCollection> & object
) {
  if (!rule) return NextResponse.json({ status: "no-rule" })
  const slackConfig = rule.slackConfig
  if (!slackConfig?.channel) {
    return NextResponse.json(
      { status: "error", message: "slackConfig.channel is required for slack destination" },
      { status: 400 }
    )
  }

  // Build field list from fieldMapping (from = source field code, to = display label)
  const fields = rule.fieldMapping
    .map((m) => ({ label: m.to, value: getFieldValue(record, m.from) ?? "—" }))
    .filter((f) => f.value !== "—" || true) // include all, even empty (shows "—")

  const recordUrl = slackConfig.recordUrlField
    ? getFieldValue(record, slackConfig.recordUrlField) ?? undefined
    : undefined

  await postSlackMessage({
    channel: slackConfig.channel,
    headerText: slackConfig.messagePrefix ?? "Record updated",
    collectionId,
    recordId,
    fields,
    recordUrl,
  })

  return NextResponse.json({
    status: "processed",
    adapter: "slack",
    collectionId, recordId,
    channel: slackConfig.channel,
    fieldCount: fields.length,
  })
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function buildFieldMap(
  record: SourceRecord,
  mapping: Array<{ from: string; to: string }>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const m of mapping) {
    const value = getFieldValue(record, m.from)
    if (value) result[m.to] = value
  }
  return result
}

async function maybeWriteBack(
  collectionId: string,
  recordId: string,
  rule: ReturnType<typeof getRuleForCollection>,
  id: string,
  url: string | null,
  alreadyHadId: boolean
) {
  if (!rule?.writeBack?.enabled || alreadyHadId) return

  try {
    const writeFields: SourceRecord = {}
    if (rule.writeBack.userIdField) {
      writeFields[rule.writeBack.userIdField] = { value: id }
    }
    if (rule.writeBack.userUrlField && url) {
      writeFields[rule.writeBack.userUrlField] = { value: url }
    }
    if (Object.keys(writeFields).length > 0) {
      await updateRecord(collectionId, recordId, writeFields)
    }
  } catch (err) {
    // Write-back is best-effort — log but don't fail the sync
    console.error("[webhook] Record source write-back failed (non-fatal):", err)
  }
}
