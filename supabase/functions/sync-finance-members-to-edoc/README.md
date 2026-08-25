# Finance -> eDoc sync worker

This is an internal, custom-authenticated Edge Function. Deploy it with JWT
verification disabled only because it validates a dedicated 32+ byte worker
secret in constant time. It never accepts an end-user identity.

Required shared bridge secret (its value must not be committed):

- `FINANCE_EDOC_BRIDGE_SECRET`

Optional dedicated configuration, preferred when provisioned:

- `FINANCE_EDOC_SYNC_WORKER_SECRET`
- `EDOC_FINANCE_SYNC_URL`

For a zero-touch production rollout, the worker safely falls back to the
existing `FINANCE_NOTIFICATION_WORKER_SECRET` and to the fixed production eDoc
ingress URL. A separately provisioned sync secret/URL still takes precedence.

Supabase supplies `SUPABASE_URL` and either `SUPABASE_SERVICE_ROLE_KEY` or
`SUPABASE_SECRET_KEYS`. The worker keeps both Finance credentials server-side.

Create/update these Vault entries separately after the function exists:

- `finance_edoc_sync_worker_url`: the deployed Edge Function URL
- `finance_edoc_sync_worker_secret`: the same dedicated worker secret
- `finance_notification_worker_anon_key`: already used as the project-level
  publishable/anon gateway key; the new migration intentionally reuses it
  instead of creating a second copy.

If the first two sync-specific Vault values do not yet exist, the wake function
derives the sibling Edge Function URL from `finance_notification_worker_url`
and reuses `finance_notification_worker_secret`. The URL derivation accepts
only the project's HTTPS `*.supabase.co/functions/v1/` host/path pattern.

The eDoc URL must be HTTPS and point to its internal Finance sync ingress. The
outgoing payload is HMAC-SHA256 signed as
`timestamp + "." + nonce + "." + rawBody` with these headers:

- `x-finance-timestamp`
- `x-finance-nonce`
- `x-finance-signature`

The eDoc ingress acknowledges a delivery with a pinned `status` enum and one
matching compatibility boolean, for example
`{"status":"applied","applied":true}`. The worker also accepts the legacy
single-boolean response during rollout, but rejects conflicting outcomes.

The worker preserves the existing schema-v1 `member.changed` and
`company.changed` envelopes. Published organization graphs use the independent
schema-v2 `organization.published` envelope. The organization snapshot contains
only whitelisted unit, assignment, and reporting-override fields; Finance-only
metadata is never forwarded. Organization assignment and reporting-override
IDs are safe opaque identifiers because legacy governance records are not
always UUIDs.

Member and company envelopes remain limited to 256 KiB. A complete published
organization envelope is limited to 1 MiB and is rejected before network
delivery when it exceeds that boundary.

Run the offline checks before any preview deployment:

```sh
node scripts/check_finance_edoc_sync_contract.js
node scripts/test_finance_edoc_sync_worker_core.mjs
```

Source triggers only write to the private durable outbox. An outbox insert
queues a best-effort asynchronous pg_net wake after commit, while the existing
once-per-minute cron remains the recovery path. Both wake paths are safe no-ops
until all required Vault values exist.

A real company payload hash change also advances each affected member's
independent sync revision. Initial installation seeds member states first, so
this company-to-member reconciliation cannot create duplicate seed rows.
