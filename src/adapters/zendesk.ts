/**
 * Zendesk adapter for record-sync-engine.
 * Resolves Zendesk user and updates user fields.
 */

export interface ZendeskResolveResult {
  userId: number | null
  userUrl: string | null
  source: "override" | "custom_field" | "not-found"
}

function subdomain(): string {
  return process.env.ZENDESK_SUBDOMAIN ?? ""
}
function auth(): string {
  const email = process.env.ZENDESK_EMAIL ?? ""
  const token = process.env.ZENDESK_API_TOKEN ?? ""
  return "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64")
}
function apiBase(): string {
  return `https://${subdomain()}.zendesk.com/api/v2`
}

/**
 * Resolve a Zendesk user by a custom field value.
 * Returns null if no match or multiple matches (multiple = dangerous, skip).
 */
export async function resolveUserByCustomField(
  fieldKey: string,
  value: string
): Promise<ZendeskResolveResult> {
  // Try both normalized forms: "WO-1234" and "1234"
  const candidates = Array.from(new Set([value, value.replace(/^WO-/, "")]))

  for (const candidate of candidates) {
    const url = `${apiBase()}/users/search.json?query=${encodeURIComponent(`${fieldKey}:${candidate}`)}`
    const res = await fetch(url, { headers: { Authorization: auth() } })
    if (!res.ok) continue

    const data = await res.json()
    const users = data.users ?? []

    if (users.length === 1) {
      return {
        userId: users[0].id,
        userUrl: users[0].url,
        source: "custom_field",
      }
    }
    if (users.length > 1) {
      console.warn(`[zendesk] Multiple users found for ${fieldKey}:${candidate} — skipping`)
      return { userId: null, userUrl: null, source: "not-found" }
    }
  }

  return { userId: null, userUrl: null, source: "not-found" }
}

/**
 * Update Zendesk user fields.
 */
export async function updateUserFields(
  userId: number,
  fields: Record<string, string | null>
): Promise<void> {
  const url = `${apiBase()}/users/${userId}.json`
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ user: { user_fields: fields } }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Zendesk updateUserFields failed: ${res.status} ${err}`)
  }
}
