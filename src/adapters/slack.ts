/**
 * Slack notification adapter.
 *
 * Unlike the Zendesk/HubSpot adapters, this sends a structured Block Kit
 * notification when a source record changes. No user resolution or write-back.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlackBlock {
  type: string
  [key: string]: unknown
}

export interface SlackMessageOptions {
  channel: string
  /** Shown in the notification preview and as fallback text */
  headerText: string
  collectionId: string
  recordId: string
  /** Key-value pairs to display in the message body */
  fields: Array<{ label: string; value: string }>
  /** Optional direct URL to the source record */
  recordUrl?: string
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Post a Block Kit message to a Slack channel.
 * Uses chat.postMessage — bot must be in the target channel.
 */
export async function postSlackMessage(opts: SlackMessageOptions): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set")

  const blocks = buildBlocks(opts)

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: opts.channel,
      text: opts.headerText, // fallback text for notifications
      blocks,
    }),
  })

  const data = await res.json()
  if (!data.ok) {
    throw new Error(`Slack chat.postMessage failed: ${data.error}`)
  }
}

// ─── Block Kit builder ────────────────────────────────────────────────────────

function buildBlocks(opts: SlackMessageOptions): SlackBlock[] {
  const blocks: SlackBlock[] = []

  // Header
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: opts.headerText, emoji: true },
  })

  // Fields section (2-column layout using Slack section fields)
  if (opts.fields.length > 0) {
    // Slack sections support max 10 fields; split if needed
    const chunks = chunkArray(opts.fields, 10)
    for (const chunk of chunks) {
      blocks.push({
        type: "section",
        fields: chunk.map((f) => ({
          type: "mrkdwn",
          text: `*${f.label}*\n${f.value || "—"}`,
        })),
      })
    }
  }

  // Context: Collection ID + Record ID
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Collection: \`${opts.collectionId}\` · Record: \`#${opts.recordId}\``,
      },
    ],
  })

  // "View Record" button (if URL available)
  if (opts.recordUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View record", emoji: true },
          url: opts.recordUrl,
          action_id: "view_source_record",
        },
      ],
    })
  }

  return blocks
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
