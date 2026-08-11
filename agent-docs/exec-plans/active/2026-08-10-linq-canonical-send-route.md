# Canonical Linq send route

Status: active
Updated: 2026-08-10

## Goal

Make Web the only send-time authority for Linq target, target kind,
directness, conversation locator, direct recipient, and sender so scheduled,
interactive, group, card, voice, and private-continuation delivery cannot
assemble a route from origin-dependent runtime hints.

Success means:

- every Linq provider attempt obtains one complete ephemeral route from Web;
- capability lookup and provider dispatch reassert that exact route;
- private scheduled cards do not require a foreground actor to recover the
  already-authorized direct recipient;
- route drift or protocol absence fails closed without becoming a plaintext
  fallback;
- existing card and voice recovery behavior remains intact for non-authority
  capability failures, unavailability, or definitive provider rejection; and
- Web and Cloudflare can roll out safely without a correctness gap.

## Evidence

- The scheduled closeout produced the correct nutrition totals but skipped the
  native card before provider dispatch.
- The immediate interactive retry sent the card successfully with the same
  frozen totals, excluding a card renderer or provider acceptance failure.
- The runtime previously combined target, recipient, sender, and directness
  from request hints, foreground delivery context, and Web authority response.
  Scheduled execution lacked the foreground recipient hint even though Web
  could resolve the authorized private route.
- Web already owns the current-route, membership, line, and engagement checks,
  so a second state owner or persisted route snapshot is unnecessary.

## Implementation

1. Define one typed `HostedExecutionResolvedLinqDeliveryRoute` contract in the
   hosted-execution owner package.
2. Resolve the complete route inside Web's existing engagement authority
   boundary for direct, group, home-route fallback, and signup-welcome sends.
3. Return that route on authority-only checks and require exact equality on
   capability and provider-dispatch reassertions.
4. Make the runtime use only the asserted route for provider target, recipient,
   sender, and directness; keep caller hints only as untrusted candidates for
   Web's initial resolution.
5. Keep legacy Web response fields during a bounded Web-first deployment
   window so the pre-change runtime remains functional until Cloudflare is
   updated. New runtimes still require the canonical route and fail closed
   against old Web responses.
6. Cover scheduled cards, direct and group messages, current-home rerouting,
   private continuation, voice memos, protocol absence, and route drift.
7. Attribute every accepted or failed delivery outcome to the resolved sender;
   replay-scoped line keys are neither emitted by the canonical runtime nor
   allowed to override a canonical sender number at the Web outcome boundary.

## Invariants

- Web remains the sole send-time authority; runtime state cannot authorize a
  destination or sender.
- The resolved route is ephemeral and is never persisted as canonical product
  truth, queued as a second delivery obligation, or reused across attempts.
- Every provider side effect is preceded by an exact live authority assertion.
- A route mismatch is provider-skipped and cannot expose private response text
  through recovery delivery.
- Provider outcome, receipt, counter, and line-health attribution use the same
  sender Web authorized for provider dispatch, never stale wake authority.
- Current inbound replies, group routing, signup welcome, private Assistant Ask
  continuation, and existing line-health enforcement remain available.
- No new service, queue, database row, migration, dependency, or route manager
  is introduced.

## Verification

- Focused Web engagement and group route tests pass: 199 tests.
- Focused Assistant Runtime callback, channel, workspace phase, entrypoint,
  and runner tests pass: 933 tests.
- Full Assistant Runtime package coverage passes: 2,163 tests with 4 skipped.
- Focused Cloudflare parser/platform tests pass: 151 tests.
- Focused changelog registry and archive tests pass: 41 tests.
- Hosted-execution, Web, Assistant Runtime, and Cloudflare typechecks pass.
- The Docker-backed hosted-local scheduled-card scenario built every runtime
  package and runner bundle, then stopped before execution because this host
  has no `docker` executable (`spawn docker ENOENT`). The scheduled-card runtime
  path remains covered by the passing callback and workspace-runner tests.
- Final diff whitespace and identifier scans pass. The only secret-like value
  is an explicit non-production test token fixture.
- The first exact-head platform coverage shard exposed an `explicit` versus
  canonical `thread` comparison on approved vault-file delivery plus two stale
  integration mocks. The semantic comparison is corrected, the two failing
  files pass (12 tests), and the full package coverage rerun passes.
- Preliminary ReviewGPT accepted the product purpose and found two evidence
  gaps. Canonical-route protocol absence now has focused Cloudflare parser and
  Assistant Runtime fail-closed tests (151 and 243 tests pass respectively),
  with no capability, provider, fallback-persistence, or outcome side effect.
  The production-faithful scheduled-card scenario remains blocked because no
  Docker-compatible engine is installed; the PR does not claim unchanged
  foreground latency without the requested same-environment benchmark.
- Final ReviewGPT Round 1 found that the outcome builder still emitted a stale
  replay-context line key after a current-home reroute. The builder no longer
  emits that obsolete hint, Web prefers the canonical sender number if an old
  caller supplies both fields, and focused accepted, failed, voice, and Web
  route tests prove the stale key cannot replace current line attribution
  (244 runtime callback tests and 151 Web outcome/observability tests pass).
- The same review independently found the already-remediated `explicit` versus
  `thread` vault-file representation mismatch. Its PR-body discrepancies are
  corrected by disclosing scheduled pre-model route/tool scoping, secure
  approval identity, terminal line-health attribution, and all four serial Web
  control calls on the scheduled native-card journey.
- Parent full-path reread found that the live route's direct/group bit was not
  yet compared with the approval-bound vault-file intent. The guard now fails
  before approval consumption, file access, or provider work on direct/group or
  participant/thread audience drift; three negative cases pass with all 247
  callback tests and the Assistant Runtime typecheck.
- Pending: triage final ReviewGPT Round 2, commit the combined next remediation,
  reconcile the bounded changelog-only current-base conflict, rerun required
  CI, and complete the required next final ReviewGPT round.

## Deployment

Deploy Web first with both the canonical route and deprecated legacy response
fields. Deploy the Cloudflare runtime immediately after Web is healthy. Roll
back Cloudflare before Web if rollback is needed. Remove the legacy response
fields only in a later independently reviewed change after the old runtime is
outside the rollback window.

Post-deploy proof must include one authorized private scheduled native card,
one ordinary direct reply, one group reply, and one private continuation, with
no canonical-route protocol or mismatch errors.
