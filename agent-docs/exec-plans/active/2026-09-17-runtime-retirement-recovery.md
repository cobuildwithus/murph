# Recover retirement of reserved unbound runtime targets

Status: active
Created: 2026-09-17
Updated: 2026-09-17

## Goal and scope

Recover a selected runtime target when its bind RPC never committed. The owner
can carry an allocation claim while the target remains unbound; passing that
claim to the unbound retirement store prevents every subsequent recovery retry.
Fix the existing container retirement boundary without changing owner authority,
allocation, scheduling, logging payloads, or database schema.

## Protected invariants

- Validate the addressed immutable target and any persisted member identity.
- Preserve claim mismatch rejection for bound and member-bound retiring targets.
- Fence late binds synchronously before native destruction starts.
- Keep an uncertain native stop retiring; release only after confirmed retirement.
- Keep coordinator claim-free retirement and existing successful runtimes intact.

## Product UX patch

Outcome: existing runtime recovery can progress after an interrupted binding.
Reaches: members whose selected target never bound, including background work;
normal bound targets and wrong-member requests retain existing behavior.
Proof: synthetic production-shaped claimed retirement, late-bind rejection,
failed-stop retry, bound mismatch checks, focused adapter tests, and typecheck.

## Tasks

1. Reproduce the unbound claimed retirement failure with synthetic fixtures.
2. Derive effective retirement claim from persisted binding at the target boundary.
3. Run focused tests, typecheck, complexity and privacy review.
4. Complete exact-head ReviewGPT and CI, merge and deploy through existing gates.
5. Recheck bounded production outcomes; distinguish terminal forwarding from
   provider transport errors and actual recovery from merely attempted retries.

## Decisions and limits

No new state, retry loop, external call, dependency, or authority is needed.
Read and retirement fencing stay synchronous before the first await, consistent
with Cloudflare Durable Object input gates. Production rows and identifiers are
excluded from artifacts. Deployment and live recovery remain unverified until
observed; unrelated deployment ownership is preserved.

## Verification

Pending: focused Cloudflare Node tests, Cloudflare typecheck, complexity diff,
docs drift, exact-head CI and ReviewGPT, protected deployment and live readback.

## Candidate evidence

Three synthetic cases failed before the correction with the exact unbound-claim
rejection. Afterward all 178 selected container lifecycle, Postgres processing,
and user-control tests passed. Cloudflare typecheck passed after generating the
fresh checkout's Prisma client. The complexity ratchet passed with unchanged
file debt; existing unrelated wake/readiness/error-classification hotspots remain
outside this correction. Documentation drift passed. A final direct claim-only
authority regression and release checks remain pending.

Final focused proof: all 85 standby lifecycle tests pass, including direct
claim-only rejection. The selected four-file coverage is 179 tests with that
additional case. Cloudflare and Web typechecks pass; the changelog archive's
10 rendering tests pass. The documented Web test command discovered no files;
rerunning from the repository root passed, matching the existing Frog entry
`20260912202546-changelog-focused-test` without creating duplicate friction.
Product UX patch replay is Ready at the tested retirement boundary; live
recovery remains a post-deployment check. PR #3546 is the owned release path.
