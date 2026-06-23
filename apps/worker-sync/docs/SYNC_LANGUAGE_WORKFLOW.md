# sync-language

Asynchronous workflow that propagates a user's language preference change across SkyDIIV data stores.

**Hosted in:** `worker-sync`  
**Endpoint:** `POST /sync/language`  
**Registry key:** `language` (last path segment, required by `serveMany`)

---

## Payload

```json
{
  "userid": "string",
  "old_language": "string",
  "new_language": "string"
}
```

| Field | Type | Description |
|---|---|---|
| `userid` | `string` | SkyDIIV user identifier |
| `old_language` | `string` | Previous locale code (e.g. `en-US`) |
| `new_language` | `string` | New locale code (e.g. `pt-BR`) |

---

## Steps

| Step | File | Status |
|---|---|---|
| `sync-user-language` | `src/workflows/sync-language/steps/sync-user-language.ts` | Boilerplate — implement sync logic |

---

## Triggering

Publish a signed QStash message to the worker endpoint:

```bash
curl -X POST https://worker-sync.<subdomain>.workers.dev/sync/language \
  -H "Content-Type: application/json" \
  -d '{"userid":"<USER_ID>","old_language":"en-US","new_language":"pt-BR"}'
```

For local development, expose the worker with `cloudflared` and set `UPSTASH_WORKFLOW_URL` to the tunnel origin. See [README.md](../README.md).

---

## Implementation Notes

- Payload validation uses Zod in `workflow.ts` before any durable step runs.
- `resetDbClients()` is called at workflow start so DB singletons pick up Worker bindings injected in `src/index.ts`.
- Replace the TODO in `sync-user-language.ts` with the actual sync logic (DB updates, cache invalidation, derived content refresh, etc.).
