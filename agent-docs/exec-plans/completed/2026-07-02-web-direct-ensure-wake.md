# Web Direct Ensure Wake Fast Path

## Why

Prod ingress latency traces (last 7 days) show every hot-container reply pays
~1.7s p50 of pure dispatch plumbing between webhook accept and the Cloudflare
worker hearing about the message: webhook → Temporal Cloud signal (~950ms via
3-4 sequential pre-signal DB round trips + the signal RPC) → Render worker
workflow/activity dispatch (~270ms) → Render → Cloudflare fetch (~495ms).
The container-side wake itself is fast once the route arrives.

## What

1. **Direct ensure fast path**: the shared webhook wake handoff fires a
   fire-and-forget `POST /internal/users/:id/runtime/ensure-processing` to the
   Cloudflare worker through the existing `@murphai/cloudflare-hosted-control`
   client (Vercel OIDC auth, existing base-url env), in parallel with the
   unchanged Temporal signal. Temporal remains the sole durable orchestrator
   (retries, scheduled wakes, reconciliation); the direct call is a stateless
   latency hint that may be dropped at any time with no correctness impact.
   - Cloudflare ensure route accepts `vercel-oidc` in addition to
     `web-callback-signature`; the authorized scheme (not caller input)
     derives a `triggeredByWebDirect: true` boolean orchestration latency
     leaf so trace data attributes which trigger won.
   - `orchestrationAttemptId` minted by web with a `web-ingress-` prefix
     (diagnostics-only identity; DO fence CAS owns concurrency).
2. **Pre-signal trim**: `signalHostedMailboxAppendRuntime` accepts the
   already-known mailbox pointer facts from the webhook planner so the
   mailbox-append path skips the redundant checkpoint re-read, workspace
   upsert, and active-access re-check ahead of the signal RPC.

## Invariants preserved

- Temporal signal stays unconditional on every mailbox append (durability
  unchanged; no fallback branching).
- DO write-fence CAS remains the single concurrency owner; racing ensures
  already converge (`already_running` / `woken` / `retry_later`).
- Wake handoff still fires only for active members past AI-usage/quota
  admission; authoritative usage enforcement stays at turn admission.
- No new secrets or key distribution: web keeps using its existing Vercel
  OIDC identity to the worker.
- Observability writes stay off the reply hot path (fire-and-forget + after()).

## Deployment

Deploy `apps/web` before `apps/cloudflare`; deploy Cloudflare with
`container_rollout=immediate` (new boolean orchestration leaf is
sanitize-dropped by old planes but the web trace merge parser must accept it
before Cloudflare starts emitting it).

## Verification

- Owner tests: hosted-execution runtime-control leaf contracts,
  cloudflare-hosted-control client, cloudflare worker route auth + ensure
  handler, web wake handoff + signal-runtime.
- `pnpm test:diff` over touched paths + typecheck.
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
