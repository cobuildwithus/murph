# Distinguish failed native startup waits

Status: active
Created: 2026-10-16
Updated: 2026-10-16

## Goal and invariant

Distinguish the pinned Containers SDK initial-instance wait from its separate
port-readiness wait when authoritative startup confirmation fails. Preserve
readiness, absolute deadlines, cleanup, fencing, thrown errors and retries.
The existing startup failure observation is the sole telemetry owner.

## Evidence and scope

Current code collapses both waits into `cold_start_or_ports`, omitting the
caught SDK error on the pending-cold-start path. The pinned SDK supplies two
fixed cancellation messages. Existing success timing does not explain failed
waits. Synthetic installed-SDK tests must prove the exact boundary and preserve
an explicit unknown category for unrecognized failures. This does not establish
whether infrastructure allocation or application boot caused a delay.

Add only failure-only bounded structured metadata to the existing warning,
focused tests, and its owner documentation. No public API, persisted state,
SDK patch/dependency change, extra I/O, polling, retry, timeout, or product change.
No production/private content belongs in this plan or review packet.

## Ownership and architecture

RunnerContainer owns the local failed wait and observes its caught error before
RPC strips details. The existing structured logger carries the observation.
Reuse the existing invocation-local observation object; no durable owner.
Current open PRs have no competing startup failure diagnostic. The existing
idle-cleanup optimization changes a separate decision and is not a collision.

## Tasks and proof

1. ReviewGPT authors the smallest typed diagnostic and focused regression.
2. Parent verifies the patch, installed-SDK error provenance, baseline failure,
   patched proof, unchanged caller outcome, privacy, typecheck and complexity.
3. Update the existing protocol owner and index; internal-only changelog decision.
4. Scoped commit, draft PR, Ready, final ReviewGPT concurrently with exact-head CI.
5. If telemetry-only gates pass, use canonical deployment authority and verify
   the revision read-only. Preserve the exact future query when unexercised.

## Risks and deployment

SDK error text is version-specific: classify exact pinned literals only,
retain unknown and executable installed-SDK proof. Do not infer allocation
failure from either category. Additive private telemetry is optional during
mixed-version operation; old workers omit it. No consumer wire change.

## Verification

ReviewGPT authored the four-file patch. Parent inspection confirms the only
runtime addition is a failure-only closed classification in the existing catch,
before cancellation-reason restoration; the emitter keeps its best-effort guard.
The installed SDK 0.3.7 produces both exact expected Error messages: 14 tests pass.
With authored tests and original runtime source, 15 tests fail solely for the
missing field while 272 controls pass. With the patch, all 287 runner tests pass.
Cloudflare typecheck, docs drift, and whitespace checks pass. Complexity debt
remains 67 and maximum 72; existing hotspots (72, 31, 24) are unaffected owners,
and expanding this telemetry patch to refactor them is unwarranted.

No public changelog: operator-only optional metadata, with no member-visible
behavior or provider-input change. Final pushed-head ReviewGPT and required CI
remain pending. No production root-cause repair is claimed from later successes.
The user subsequently authorized reviewed functional deployment and four hours
of native heartbeat observation; telemetry deployment retains all normal gates.
