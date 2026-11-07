# Accepted instant replies and typing alerts

## Outcome and invariant

A provider-accepted Web onboarding reply must resolve its exact ingress trace,
including replay, without a fabricated runtime attempt or a telemetry wait on
the reply path. Failed or ambiguous sends remain alertable.

## Evidence and design

The instant-turn completion replaces the wake mailbox pointer with the synthetic
outbound context item. The typing monitor excludes accepted linked deliveries,
but this Web path did not link its delivery. Reuse the delivery store's stable ID,
carry it only from successful completion, and run the existing trace-link upsert
in the post-response task. Runtime senders retain their required attempt IDs;
Web sends explicitly supply null. No schema, queue, provider call, or monitor
threshold change is needed.

## Verification and completion

- Passed: 149 focused tests across instant-first-turn, webhook-wake-direct-ensure,
  latency-store and latency-alert-monitor suites. Fresh acceptance and completed
  replay carry the real stable delivery ID; no extra send occurs on replay.
- Passed: deferred linking, failed wake, telemetry failure and ordinary wake proof.
- Passed: all nine typing-alert PostgreSQL tests, using isolated temporary tables.
  The production link upsert removes the original missing-typing candidate;
  failed deliveries and unrelated messages stay alertable. Replay preserves the
  first link and stores no fabricated runtime attempt.
- Passed: Web typecheck and final prepared typecheck; focused ESLint has no errors
  and only two pre-existing unused-variable warnings in the latency-store fixture.
- Passed: complexity diff (no hotspot debt growth), whitespace and parent review.
  Changed runtime code adds one bounded post-response SQL upsert and no awaited
  work before webhook response or provider delivery. Existing ownership and
  member/source conflict guards remain intact.
- This is local scoped implementation. No PR, external ReviewGPT, exact-head CI,
  merge, or deployment was performed; those remain publication gates.
- Internal operator telemetry only; no member-visible changelog entry.
- Web-only additive rollout; old handoffs remain valid and runtime linking stays
  compatible. Production deployment and alert recovery are separate from local proof.

## Secondary investigations

Three read-only investigators cover runtime admission delay, repeated recovery
wakes, and warm typing phase latency. Private incident evidence stays outside
repository artifacts; this implementation does not change those paths.
Status: completed
Updated: 2026-09-17
Completed: 2026-09-17
