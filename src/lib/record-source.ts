/**
 * Minimal server-side client for a generic record source API.
 *
 * Expected demo contract:
 *   GET   /collections/:collectionId/records/:recordId -> { record }
 *   PATCH /collections/:collectionId/records/:recordId <- { fields }
 */

export interface SourceRecord {
  [fieldCode: string]: { value: unknown } | unknown
}

function apiBase(): string {
  const base = process.env.SOURCE_API_BASE_URL
  if (!base) throw new Error("SOURCE_API_BASE_URL is required")
  return base.replace(/\/$/, "")
}

function authHeaders(): HeadersInit {
  const token = process.env.SOURCE_API_TOKEN
  if (token) return { Authorization: `Bearer ${token}` }

  const user = process.env.SOURCE_BASIC_USERNAME
  const pass = process.env.SOURCE_BASIC_PASSWORD
  if (user && pass) {
    return {
      Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
    }
  }

  return {}
}

function recordUrl(collectionId: string, recordId: string): string {
  return `${apiBase()}/collections/${encodeURIComponent(collectionId)}/records/${encodeURIComponent(recordId)}`
}

export async function getRecord(
  collectionId: string,
  recordId: string
): Promise<SourceRecord> {
  const res = await fetch(recordUrl(collectionId, recordId), {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Record source getRecord failed: ${res.status}`)
  const data = await res.json()
  return (data.record ?? data) as SourceRecord
}

export async function updateRecord(
  collectionId: string,
  recordId: string,
  fields: SourceRecord
): Promise<void> {
  const res = await fetch(recordUrl(collectionId, recordId), {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Record source updateRecord failed: ${res.status} ${err}`)
  }
}

export function getFieldValue(record: SourceRecord, fieldCode: string): string {
  const field = record[fieldCode]
  if (field && typeof field === "object" && "value" in field) {
    return String((field as { value: unknown }).value ?? "")
  }
  return String(field ?? "")
}
