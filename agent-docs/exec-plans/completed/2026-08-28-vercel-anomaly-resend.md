# Send Vercel usage anomalies through Resend

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Alert Murph operators through the existing Resend operational-email channel
  when Vercel reports a statistically anomalous production usage or error
  spike, without adding another polling cron or a second incident lifecycle.

## Success criteria

- A bounded public Web route verifies Vercel's `x-vercel-signature` against a
  dedicated environment-owned webhook secret before parsing or sending.
- A valid `alerts.triggered` event produces one privacy-safe plain-text email
  through the existing operational Resend sender and recipient configuration.
- Vercel webhook retries reuse the event-derived Resend idempotency key, while
  unsupported signed events are acknowledged without a provider effect.
- Missing configuration, invalid signatures, malformed alert payloads, and
  Resend failures have focused deterministic proof and never log or email the
  raw webhook body.
- The deployment docs identify the new secret, webhook event, endpoint, retry
  behavior, and post-deploy smoke boundary.

## Scope

- In scope:
  - One signed Vercel Alerts webhook route in `apps/web`.
  - Reuse of the shared operational Resend transport and recipient allowlist.
  - Exact-shape validation, bounded formatting, retry idempotency, focused
    tests, and owning architecture/security/reliability/runtime docs.
- Out of scope:
  - Polling Vercel usage or logs from another five-minute cron.
  - Building a custom anomaly detector, dashboard, incident store, queue, or
    notification framework.
  - Automatic project pausing or other containment actions.
  - Diagnosing or repairing the present source of elevated invocations.

## Constraints

- Technical constraints:
  - Vercel owns anomaly detection and grouping; Web owns only authenticated
    receipt and Resend delivery.
  - The request body is read once with an explicit byte cap because signature
    verification covers the exact raw bytes.
  - The webhook secret, Resend API key, sender, and recipients remain
    environment-owned and unavailable to local execution.
  - Provider retries last up to 24 hours, so the event id is the stable Resend
    idempotency scope for the same retry window.
- Product/process constraints:
  - Operational emails contain aggregate platform metrics only and omit raw
    logs, request payloads, member identity, and account identifiers.
  - The route must not increase the normal five-minute invocation load.
  - The user explicitly authorized the signed hosted webhook and protected
    production-secret configuration in this thread.

## Risks and mitigations

1. Risk: An attacker calls the public endpoint and pages operators.
   Mitigation: fail closed on missing or invalid HMAC-SHA1 verification before
   parsing the body or entering Resend.
2. Risk: Provider retries or an ambiguous Resend response send duplicates.
   Mitigation: derive one stable idempotency key from the bounded Vercel event
   id and return non-2xx when the send is not known to have completed.
3. Risk: Alert payloads leak application or member data.
   Mitigation: accept only the documented aggregate alert schema, normalize
   bounded one-line display fields, and never persist or log the raw body.
4. Risk: Monitoring the monitor creates more scheduled cost.
   Mitigation: use Vercel's event-driven alert webhook and do not add a cron.

## Product UX Plan

- Effort: Feature. This creates a new operational notification promise while
  reusing the existing authorized alert audience and sender.
- Outcome: an operator receives a concise aggregate alert soon after Vercel
  identifies an unusual usage or function-error signal.
- Entry and promise: Vercel's anomaly owner emits a signed event; after webhook
  delivery and Resend admission, the configured operational recipients receive
  the project, time, magnitude, baseline, and a safe Vercel investigation link.
- Affected people: the configured operational recipient investigating abnormal
  platform cost or reliability. Members are deliberately excluded and no
  member or request data enters this path.
- Proof path: replay a provider-shaped signed event from route admission through
  the shared Resend call and inspect the exact plain-text body, recipients,
  retry identity, unsafe-field exclusions, and failure response.
- UX finish: lead with the anomaly, show observed versus baseline metrics, keep
  every provider display value to one line, and retain one safe investigation
  link without opaque query or fragment values.
- Done when: the ordinary signed event reaches the existing recipients with
  useful aggregate context; invalid authentication never sends; incomplete
  configuration or provider failure remains visible to Vercel as retryable.
- Approval: the user approved this signed-webhook and protected-secret design
  before implementation in the current thread.

## Tasks

1. Confirm the current Vercel alert and webhook contracts and existing Murph
   operational-email owner.
2. Add signed bounded webhook admission, strict alert parsing, aggregate email
   formatting, and shared Resend delivery.
3. Add focused handler and route proof for authentication, payload shape,
   idempotency, configuration, provider failure, and body bounds.
4. Update architecture, security, reliability, Web runtime, and environment
   documentation.
5. Run focused tests and typecheck, inspect the diff, then finish the PR lane
   through the required exact-head review and CI gates.

## Decisions

- Use Vercel's native anomaly detector. Its usage alert compares a five-minute
  window against the recent baseline, which directly matches the reported
  symptom and avoids maintaining a second threshold model.
- Reuse `sendHostedResendPlainTextEmail` and
  `readHostedOperationalAlertEmailConfig`; do not extend the database-backed
  scheduled incident monitor because Vercel already owns alert grouping and
  webhook retry.
- Subscribe the endpoint only to `alerts.triggered`. A valid signed event id is
  the retry identity; no new database table or receipt collection is needed.

## Verification

- Commands to run:
  - Focused Vitest files for the new handler and route.
  - `pnpm --dir apps/web typecheck` or the current focused Web typecheck owner.
  - Documentation/reference guards selected by the verification map.
  - `git diff --check` and a final identifier/secret scan of the scoped diff.
- Expected outcomes:
  - Valid signed alerts send once with the expected aggregate body and stable
    idempotency key.
  - Invalid or missing authentication, invalid bodies, and incomplete config
    fail before Resend; unsupported signed events produce no send.
  - The scoped Web typecheck and documentation guards pass.

## Product UX Walkthrough

- People and paths: replayed the sole materially different operator path from
  a provider-shaped `alerts.triggered` request through signature admission,
  bounded formatting, and the shared operational-email call. Replayed invalid
  signature, malformed payload, missing email configuration, and Resend
  rejection recovery paths. Members remain outside the path.
- Evidence: 20 focused handler/route tests inspect the exact email, observed
  and baseline aggregates, recipients, stable retry identity, stripped URL
  query/fragment values, small nonzero precision, action-first 20-alert
  formatting, unsafe-field exclusion, failure status, body cap, and absence
  from Vercel cron registration.
- Differences from plan: the specialist review tightened numeric precision and
  moved the investigation link ahead of compact detail blocks. The
  implementation remains event-driven and adds no database, queue, custom
  detector, dashboard, or member-visible state.
- Result: Ready.

## Verification Results

- Focused Vitest: passed after specialist remediation, 2 files and 20 tests.
- Web typecheck: passed.
- Scoped ESLint: passed.
- Agent docs drift guard: passed.
- `git diff --check`: passed.

## Review Results

- Preliminary specialist review: findings. Accepted all three: preserve tiny
  nonzero aggregate values, move the investigation action before bounded alert
  details and compact repeated labels, and remove the narrow feature summary
  from the mandatory agent index. The corrected focused proof passes.
- Corrected Product UX purpose verdict: Ready. The irreducible purpose is a
  truthful, skimmable, action-first anomaly email that lets an operator judge
  magnitude and open the affected Vercel investigation. The corrected email
  preserves every promised aggregate, keeps small values nonzero, and places
  the action before the first detail block at maximum visible cardinality.
- Final ReviewGPT round 1 at the immutable first-reviewed head: pass with no
  qualifying cross-cutting findings. A substantive round 2 is required for the
  behavior-bearing specialist remediation.
- Final ReviewGPT round 2 at the corrected head: pass with no qualifying
  findings. The original same-thread capture became unavailable after its
  bounded wait and recovery retries, so the same substantive round completed
  as a fresh full-snapshot audit on a different healthy browser lane without
  advancing the round counter.
- Required GitHub checks at the corrected production head: passed.
- Current-base `git merge-tree --write-tree`: passed without conflicts after a
  fresh fetch of `origin/main`.
Completed: 2026-08-28
