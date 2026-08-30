# Page operators on AI egress authorization failure

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Reuse Murph's existing operator Linq page transport to send an immediate,
  privacy-safe SEV1 text when an authorized OpenAI request is rejected with
  HTTP 401 or 403, without adding work to successful provider requests.

## Success criteria

- The first authorized upstream OpenAI 401/403 opens one durable incident and
  schedules one stable-idempotency page to both existing operator chats.
- Repeated failures coalesce, with at most one reminder per hour while failures
  remain current and a new incident after a quiet recovery window.
- Failed alert delivery remains pending and is retried by the owning Durable
  Object's native alarm; Linq destination and line-health checks remain
  unchanged.
- The operator message contains only severity, provider, upstream status,
  aggregate count, and timestamps. It contains no member, request, prompt,
  message, credential, model input, or provider response body.
- The upstream OpenAI response and member-facing retry behavior remain
  unchanged even if alert reporting or alert delivery fails.
- Focused monitor, Worker, egress, configuration, and deployment-contract tests
  pass, followed by required ReviewGPT and exact-head CI gates.

## Scope

- In scope:
  - One new SQLite Durable Object as the narrow global dedupe/retry owner.
  - Authorized OpenAI 401/403 reporting from the existing Worker egress seam.
  - Reuse of the existing two operator chats, Linq token, sender health checks,
    and operator-alert transport.
  - Additive Cloudflare binding/migration, focused tests, and durable deploy and
    runtime documentation.
- Out of scope:
  - Public status updates or a second incident source of truth.
  - Member-facing copy, retries, provider selection, or delivery behavior.
  - Reading, validating, rotating, or exposing the production OpenAI secret.
  - Generic alerts for every provider/status without production evidence.
  - New queues, cron expressions, messaging providers, or Web-owned state.

## Constraints

- Technical constraints:
  - Persist admission before external send and reuse stable provider
    idempotency keys.
  - Keep the success path free of Durable Object calls and database work.
  - Report alert failures as bounded metadata and never mask the original
    upstream response.
  - Use an additive SQLite Durable Object migration and its one native alarm
    for pending-send retry and quiet-window closure.
- Product/process constraints:
  - Product UX effort: Product change to the existing operator-page journey.
  - Outcome: on-call operators learn about a global AI authorization outage in
    minutes instead of waiting for a manual production sweep.
  - Entry and promise: the first proven authorized upstream rejection creates
    one urgent page; continuing failures create bounded reminders.
  - Affected people: the two existing on-call operator-chat recipients receive
    short actionable evidence; members receive no new message and their
    existing provider response path is unchanged.
  - Failure/recovery: unhealthy Linq destinations fail closed, a failed send
    remains pending, and incident.io remains the coordination source of truth.
  - Existing established direct chats, line-health preflight, low volume, and
    one-hour pacing preserve messaging deliverability.

## Risks and mitigations

1. Risk: concurrent failures send duplicate operator texts.
   Mitigation: serialize through one named Durable Object, persist one pending
   body/key, and claim each attempt before provider entry.
2. Risk: alerting adds latency or changes a failed member request.
   Mitigation: persist through a best-effort background RPC, catch every alert
   error, and return the original OpenAI response unchanged.
3. Risk: operator texts expose private runtime evidence.
   Mitigation: accept only status and timestamp at the RPC boundary and format
   a closed aggregate-only message inside the Durable Object.
4. Risk: a transient single error causes repeated pages.
   Mitigation: one first-error page is intentional for a global injected
   credential; reminders are hourly and only while fresh failures continue.
5. Risk: the new Durable Object cannot be rolled out or rolled back safely.
   Mitigation: add one SQLite namespace migration and binding, document the
   Cloudflare-only deployment/forward-fix path, and keep older Workers free to
   ignore the additive namespace.

## Tasks

1. Add the AI-egress alert store, monitor, and Durable Object wrapper.
2. Wire authorized OpenAI 401/403 outcomes into the alert RPC without touching
   successful provider requests.
3. Reuse the existing Linq operator-alert transport and use the incident
   Durable Object's one alarm for retry and quiet-window closure.
4. Add the binding, SQLite migration, worker contracts, exports, tests, and
   deploy/runtime documentation.
5. Run focused proof, privacy/deliverability review, preliminary specialist
   ReviewGPT, final ReviewGPT, CI, and parent final review.

## Decisions

- Alert on the first authorized OpenAI 401/403 because the credential is
  Worker-owned and global; this is materially different from a per-member bad
  request or a transient upstream 5xx.
- Close the incident after fifteen minutes without another authorization
  rejection. No recovery text is sent; incident.io owns live coordination.
- Reuse the existing operator chat identities and Linq sender instead of adding
  phone numbers, recipient state, or another provider configuration.

## Verification

- Completed local proof:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
    --no-coverage apps/cloudflare/test/runner-egress-intercept.test.ts
    apps/cloudflare/test/openai-authorization-alert-durable-object.test.ts
    apps/cloudflare/test/deploy-automation.test.ts` — 300 tests passed.
  - `pnpm exec vitest run --config
    packages/hosted-local-harness/vitest.config.ts --no-coverage
    packages/hosted-local-harness/test/dev-hosted-local/environment.test.ts` —
    94 tests passed.
  - `pnpm exec vitest run --config
    apps/cloudflare/vitest.workers.config.ts --no-coverage
    apps/cloudflare/test/workers/database-health-e2e.test.ts` — 5 tests passed
    and the new Workers binding/class configuration loaded successfully.
  - `pnpm --filter @murphai/cloudflare-runner typecheck` — passed.
  - `pnpm --filter @murphai/hosted-local-harness typecheck` — passed.
  - `git diff --check` — passed.
- Direct Product UX walkthrough:
  - Each existing operator recipient gets the same four-line SEV1 page with
    only status, aggregate count, and first/last UTC timestamps.
  - A first 401/403 schedules the page immediately; repeated failures coalesce;
    fresh failures after one hour may schedule one reminder; 15 quiet minutes
    close the incident without a recovery text.
  - Failed Linq delivery retains the exact persisted body and idempotency key
    for five-minute alarm retry. Members receive no new message, and alert
    failure leaves the original OpenAI response object unchanged.
- Remaining gates:
  - Exact pushed-head preliminary Product UX/coverage specialist ReviewGPT,
    final sensitive-context ReviewGPT, required GitHub checks, and parent final
    review.
