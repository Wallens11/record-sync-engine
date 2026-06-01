# Record Sync Engine

Rule-driven webhook sync engine for moving updates from a generic record source into external tools such as Zendesk, HubSpot, and Slack.

Built with Next.js and designed for small operational workflows where the risky part is not the API call itself, but the mapping, lookup, write-back, and failure handling around it.

## How It Works

```text
Record source webhook
  -> POST /api/webhooks/source
      -> validate webhook token
      -> load sync-rules.json
      -> route by collectionId
      -> fetch latest source record server-side
      -> resolve destination object
      -> update mapped destination fields
      -> optionally write resolved IDs back to the source record
```

## Quick Start

```bash
git clone https://github.com/Wallens11/record-sync-engine.git
cd record-sync-engine
pnpm install
cp .env.example .env.local
cp sync-rules.example.json sync-rules.json
pnpm dev
```

Health check:

```bash
curl http://localhost:3000/api/healthz
```

Webhook URL helper:

```bash
pnpm webhook:url https://your-host.vercel.app
# https://your-host.vercel.app/api/webhooks/source?token=YOUR_TOKEN
```

## Source API Contract

This public template expects a generic record API shape:

```text
GET   /collections/:collectionId/records/:recordId
PATCH /collections/:collectionId/records/:recordId
```

`GET` can return either the record directly or `{ "record": { ... } }`. Fields may be plain values or `{ "value": ... }` objects.

## Sync Rules

`sync-rules.json` is gitignored. Use `sync-rules.example.json` as a fake-data starting point.

```json
[
  {
    "collectionId": "customers",
    "enabled": true,
    "source": { "lookupFieldCode": "externalCustomerId" },
    "destination": {
      "type": "zendesk",
      "lookupFieldKey": "external_customer_id"
    },
    "fieldMapping": [
      { "from": "status", "to": "customer_status" },
      { "from": "plan", "to": "customer_plan" }
    ],
    "writeBack": {
      "enabled": true,
      "userIdField": "zendeskUserId",
      "userUrlField": "zendeskUserUrl"
    }
  }
]
```

## Environment

| Variable | Required | Purpose |
|---|---:|---|
| `SOURCE_API_BASE_URL` | yes | Base URL for the record source API |
| `SOURCE_API_TOKEN` | usually | Bearer token for the source API |
| `SOURCE_WEBHOOK_TOKEN` | yes | Shared secret for inbound webhook requests |
| `ZENDESK_SUBDOMAIN` / `ZENDESK_EMAIL` / `ZENDESK_API_TOKEN` | adapter-specific | Zendesk user updates |
| `HUBSPOT_ACCESS_TOKEN` / `HUBSPOT_PORTAL_ID` | adapter-specific | HubSpot contact updates |
| `SLACK_BOT_TOKEN` | adapter-specific | Slack notifications |

## Diagnostics

```bash
GET /api/debug/sync-record?collectionId=customers&recordId=rec_123&token=YOUR_TOKEN
```

The diagnostic route fetches the source record, applies the configured mapping, and shows how the destination object would be resolved.

## Adding an Adapter

1. Create `src/adapters/your-service.ts`.
2. Export resolver/update functions matching the existing adapters.
3. Add the adapter name to `destination.type` in `src/lib/sync-rules.ts`.
4. Wire it in `app/api/webhooks/source/route.ts`.

## Security Notes

- Source credentials stay server-side.
- `sync-rules.json` is ignored by default because real field mappings often reveal business schema.
- Write-back is best-effort and non-fatal so external destination updates do not get rolled back because of a source-side metadata failure.

## License

MIT
