# Page operators on AI egress authorization failure

Status: active
Created: 2026-08-29
Updated: 2026-08-30

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
   Mitigation: use `waitUntil` when the runtime owns it; otherwise await only
   the short failed-401/403 Durable Object admission. Catch every alert error
   and return the original OpenAI response object unchanged.
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
- ReviewGPT's final round-one lifetime finding was accepted: the real
  Containers outbound context has no `waitUntil`, so the failed 401/403 path
  must await the same caught report promise when registration is unavailable or
  throws. Successful egress and all nonqualifying paths remain non-alerting.
- ReviewGPT's complexity-collapse finding was accepted: delete the redundant
  attempt generation and lease state. The exact pending tuple plus its
  five-minute retry timestamp now owns both reservation and retry timing; the
  production sender's bounded phases complete well inside that interval.
- The preliminary coverage finding was accepted and resolved with one
  Workers-pool composition across the alert binding behavior and real Linq
  sender using only synthetic fake transport.
- Changelog: not applicable. This changes internal operator paging only;
  members receive no new message, response, control, or visible recovery state.

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
- Corrected-candidate proof after accepted ReviewGPT remediation:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
    --no-coverage apps/cloudflare/test/openai-authorization-alert-durable-object.test.ts
    apps/cloudflare/test/runner-egress-intercept.test.ts` — 275 tests passed.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts
    --no-coverage apps/cloudflare/test/workers/openai-authorization-alert-e2e.test.ts`
    — 1 composed Workers-pool test passed.
  - `pnpm --filter @murphai/cloudflare-runner typecheck` — passed after
    ReviewGPT replaced the package-typed Containers test import with the
    existing production-shaped repository stub; no cast or production change.
  - Focused rerun of `runner-egress-intercept.test.ts` — 264 tests passed.
  - ReviewGPT patch gzip SHA-256
    `0e049693b56262330ca89a9d131ecaa3e054bbb1f78be203ac9bcd2e84cb7596`
    and decoded patch SHA-256
    `4ab51b92d8c9e45b6730dd30f1e8cb0529ed0f57b8551a422a52dc4938c2f2e5`
    independently matched; `git apply --check --whitespace=error-all` passed.
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
  - The preliminary Product UX/coverage specialist ReviewGPT is complete; its
    one coverage finding is resolved by the composed Worker proof above.
  - Push the corrected candidate, run final sensitive-context ReviewGPT round
    two against the immutable round-one baseline, require exact-head GitHub
    checks, and complete the parent final review.
