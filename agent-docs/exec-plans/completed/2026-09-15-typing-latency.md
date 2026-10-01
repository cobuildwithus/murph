# Remove avoidable typing latency

## Outcome and invariants

- Outcome: reduce webhook-to-typing latency by removing measured redundant work.
- Reaches: established conversations arriving during background completion or checkpointing.
- Proof: composed runtime promotion tests, startup profiling, focused typecheck and review.
- Preserve authenticated admission, current-input ordering, initial activation, cancellation, and eventual system-work recovery.

## Evidence and decisions

A bounded metadata-only production investigation localized the dominant delay
before Worker handler execution. Handler authentication and active wake were
short; worker startup versus platform scheduling remains under investigation.
A second system-only mailbox fetch also followed a successfully staged
conversation during background promotion. Ordinary conversation admission
already reuses one combined conversation/system snapshot; promotion should use
that same existing boundary.

No new scheduler, cache, state, dependency, or typing owner is proposed. Do not
change alert thresholds. Keep production correlation and raw evidence out of
repository artifacts.

## Work

- [x] Trace ingress, runtime staging, and provider typing acceptance.
- [x] Measure Worker startup cost; keep platform scheduling uncertainty explicit.
- [x] Reproduce the redundant promotion fetch in both existing composed tests.
- [x] Reuse the existing combined mailbox prefetch for promotion.
- [x] Run focused regressions and typecheck; inspect the final diff and complexity.
- [x] Record actual evidence, remaining platform uncertainty, and deployment boundary.

## Failure and deployment

The existing mailbox importer continues to own lane ordering, first-owner
activation refresh, retry bounds, authority, and cancellation. Only the fetched
lane selection changes. No persisted schema or protocol change is needed.
Runtime deployment is required before production can benefit; local tests do
not establish production latency recovery.

## Final changes and proof

Four source-line replacements reuse existing owners. Both promotion paths now
fetch the bounded conversation/system snapshot once. Established admission uses
one remote fetch instead of two while preserving system-prefix processing.
Zero system watermarks and changed cursors retain their existing refresh rules.
No retry, timeout, authority, or provider-input contract was added.

Email normalization and directness import the identical text helpers from
`shared-runtime.ts` instead of the filesystem helper barrel. Wrangler's real
Worker bundle has zero core-package inputs instead of 89, and JavaScript falls
from 4,210,701 to 3,786,488 bytes (424,213 bytes removed). Three alternating local
prebuilt-bundle profiles measured median non-idle samples of 127.8 ms before and
109.9 ms after. These local samples do not prove the production pre-handler
stall's cause or promise a fixed end-to-end latency.

Validation:

- Assistant-runtime system-preemption, promoted-foreground-priority, and
  workspace-runner suites: 196 tests passed. The strengthened promotion cases
  first failed with one redundant fetch in each path, then passed with zero.
  Both also prove prefetched preference input reaches admission.
- Inbox hosted-conversation and connector suites: 14 tests passed.
- Cloudflare hosted-email ingress and route suites: 39 tests passed.
- Changelog archive rendering: 10 tests passed.
- Assistant-runtime, Inbox, and Web typechecks passed.
- Wrangler startup check and Worker dry-run passed with container rollout
  disabled. The initial default startup check required absent container build
  artifacts; the documented Worker-only option provided the relevant proof.
- Complexity guard passed with no change in production cyclomatic complexity;
  existing large runtime hotspots need no new branches or abstraction here.
- Documentation drift, gardening, and whitespace checks passed.
- Parent reviewed the complete diff, privacy, public import boundaries, bounded
  lane reuse, first-owner refresh, cancellation, deferred-work recovery, and
  identical email helper behavior. Product UX patch verdict: Ready for rollout;
  production latency remains unverified.

## Handoff

Local implementation is complete. No PR, production mutation, synthetic live
message, or deployment was performed. The PR-specific external review and
exact-head CI gates apply when this candidate enters the PR lane.

Deploy the Worker and runner through the normal reviewed release path. These
changes use existing wire shapes and persisted state, so either component can
converge independently. Verify natural warm-message timing after deployment,
including Cloudflare edge-to-handler time and the absence of the second
system-only mailbox fetch. The dominant observed pre-handler wait remains a
platform/startup boundary finding, not a proven fixed production outcome.
Status: completed
Updated: 2026-09-15
Completed: 2026-09-15
