#!/usr/bin/env node
// Usage: node scripts/webhook-url.js https://your-host.vercel.app
const host = process.argv[2]
if (!host) { console.error("Usage: node scripts/webhook-url.js <host>"); process.exit(1) }
const token = process.env.SOURCE_WEBHOOK_TOKEN || "<SOURCE_WEBHOOK_TOKEN>"
console.log(`${host.replace(/\/$/, "")}/api/webhooks/source?token=${token}`)
