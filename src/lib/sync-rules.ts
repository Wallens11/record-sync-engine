import fs from "fs"
import path from "path"

export interface FieldMapping {
  from: string
  to: string
}

export interface WriteBackConfig {
  enabled: boolean
  /** Source field code to write the downstream user/contact ID back to */
  userIdField?: string
  /** Source field code to write the downstream profile URL back to */
  userUrlField?: string
}

/** Slack-specific config — only used when destination.type === "slack" */
export interface SlackConfig {
  /** Target channel, e.g. "#record-updates" or a channel ID */
  channel: string
  /** Text shown in the notification header. Defaults to "Record Updated". */
  messagePrefix?: string
  /**
   * Source field code whose value contains a direct URL to the record.
   * Shown as a "View Record" button if present.
   */
  recordUrlField?: string
}

export interface SyncRule {
  collectionId: string
  enabled: boolean
  description?: string
  source: {
    /** Field code used to look up the matching record in the destination system */
    lookupFieldCode: string
  }
  destination: {
    type: "zendesk" | "hubspot" | "slack"
    /** Property/field key in the destination system used for lookup (not used for Slack) */
    lookupFieldKey: string
  }
  fieldMapping: FieldMapping[]
  /** Write resolved downstream ID back to the source record (not used for Slack) */
  writeBack?: WriteBackConfig
  /** Slack-specific config — required when destination.type === "slack" */
  slackConfig?: SlackConfig
}

let cachedRules: SyncRule[] | null = null

export function loadSyncRules(): SyncRule[] {
  if (cachedRules) return cachedRules

  const rulesPath = path.join(process.cwd(), "sync-rules.json")
  if (!fs.existsSync(rulesPath)) {
    console.warn("[sync-rules] sync-rules.json not found — falling back to env-based config")
    return []
  }

  try {
    const raw = fs.readFileSync(rulesPath, "utf-8")
    cachedRules = JSON.parse(raw) as SyncRule[]
    console.log(`[sync-rules] Loaded ${cachedRules.length} rules`)
    return cachedRules
  } catch (err) {
    console.error("[sync-rules] Failed to parse sync-rules.json:", err)
    return []
  }
}

export function getRuleForCollection(collectionId: string): SyncRule | null {
  const rules = loadSyncRules()
  return rules.find((r) => r.collectionId === collectionId && r.enabled) ?? null
}
