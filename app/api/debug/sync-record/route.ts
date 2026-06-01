import { NextRequest, NextResponse } from "next/server"
import { getRuleForCollection } from "@/src/lib/sync-rules"
import { getRecord, getFieldValue } from "@/src/lib/record-source"
import { resolveUserByCustomField } from "@/src/adapters/zendesk"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (token !== process.env.SOURCE_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const collectionId = req.nextUrl.searchParams.get("collectionId") ?? process.env.DEFAULT_SOURCE_COLLECTION_ID ?? ""
  const recordId = req.nextUrl.searchParams.get("recordId") ?? ""

  if (!recordId) {
    return NextResponse.json({ error: "recordId is required" }, { status: 400 })
  }

  const rule = getRuleForCollection(collectionId)
  if (!rule) {
    return NextResponse.json({ error: "No rule found for collectionId", collectionId })
  }

  const record = await getRecord(collectionId, recordId)
  const lookupValue = getFieldValue(record, rule.source.lookupFieldCode)
  const overrideField = rule.writeBack?.userIdField
  const overrideValue = overrideField ? getFieldValue(record, overrideField) : ""

  const resolved = overrideValue
    ? { userId: Number(overrideValue), userUrl: null, source: "override" as const }
    : await resolveUserByCustomField(rule.destination.lookupFieldKey, lookupValue)

  const mappedFields: Record<string, string> = {}
  for (const m of rule.fieldMapping) {
    mappedFields[m.to] = getFieldValue(record, m.from)
  }

  return NextResponse.json({
    collectionId,
    recordId,
    lookupValue,
    overrideValue: overrideValue || null,
    zendeskUserIdSource: resolved.source,
    zendeskUserId: resolved.userId,
    mappedFields,
    updatedFieldKeys: Object.keys(mappedFields).filter((k) => mappedFields[k]),
  })
}
