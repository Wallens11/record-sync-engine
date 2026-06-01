/**
 * HubSpot CRM adapter for record-sync-engine.
 *
 * Resolves a HubSpot contact by a contact property and updates its properties.
 * Mirrors the Zendesk adapter interface so the webhook handler can treat them uniformly.
 *
 * Required env vars:
 *   HUBSPOT_ACCESS_TOKEN  — Private App token (Settings → Integrations → Private Apps)
 *   HUBSPOT_PORTAL_ID     — Used to build the contact URL (optional, for write-back)
 */

export interface HubSpotResolveResult {
  contactId: string | null
  contactUrl: string | null
  source: "property" | "not-found"
}

function apiBase() { return "https://api.hubapi.com" }
function headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN ?? ""}`,
    "Content-Type": "application/json",
  }
}

/**
 * Resolve a HubSpot contact by a property value.
 *
 * Uses the CRM Search API — works with both built-in properties (e.g. "email")
 * and custom properties (e.g. "external_customer_id").
 *
 * Returns null if no match or multiple matches (multiple = ambiguous, skip).
 */
export async function resolveContactByProperty(
  propertyName: string,
  value: string
): Promise<HubSpotResolveResult> {
  const res = await fetch(`${apiBase()}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName, operator: "EQ", value },
          ],
        },
      ],
      properties: ["hs_object_id"],
      limit: 2,
    }),
  })

  if (!res.ok) {
    console.warn(`[hubspot] Search failed: ${res.status} ${await res.text()}`)
    return { contactId: null, contactUrl: null, source: "not-found" }
  }

  const data = await res.json()
  const results: Array<{ id: string }> = data.results ?? []

  if (results.length === 1) {
    const id = results[0].id
    const portalId = process.env.HUBSPOT_PORTAL_ID ?? ""
    return {
      contactId: id,
      contactUrl: portalId
        ? `https://app.hubspot.com/contacts/${portalId}/contact/${id}`
        : null,
      source: "property",
    }
  }

  if (results.length > 1) {
    console.warn(
      `[hubspot] Multiple contacts found for ${propertyName}:${value} — skipping`
    )
  }

  return { contactId: null, contactUrl: null, source: "not-found" }
}

/**
 * Update HubSpot contact properties via PATCH.
 *
 * @param contactId  HubSpot numeric contact ID (as string)
 * @param properties  key → value map of property names to new values
 */
export async function updateContactProperties(
  contactId: string,
  properties: Record<string, string>
): Promise<void> {
  const res = await fetch(
    `${apiBase()}/crm/v3/objects/contacts/${contactId}`,
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ properties }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`HubSpot updateContactProperties failed: ${res.status} ${err}`)
  }
}
