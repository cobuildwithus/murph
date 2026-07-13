# PR 546 ReviewGPT round 10 remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Restore the wired Preview-to-Apply proof contract and remove the redundant
  provider reread that makes cleanup exceed its declared candidate budget.

## Success criteria

- The ops route accepts body-bounded opaque proof strings without owning their
  version; the service remains the only semantic proof validator.
- A real Preview v4 proof reaches Apply unchanged through the client and route.
- Provider cleanup uses its fresh in-lock exact disposition directly for
  cancellation instead of retrieving the same subscription again.
- The cleanup transaction has a two-provider-call envelope and preserves exact
  member/customer/policy/item/current-owner/proof checks and resource-missing
  idempotency.
- Focused regressions, required re-audits, full verification, exact-head CI,
  and merge pass. No ReviewGPT round beyond the configured ten-round cap.

## Constraints

- Delete duplicated proof-version and provider-authority validation.
- Reuse the existing service proof comparison, member mutation lock, exact
  disposition, and cancellation primitive.
- Add no persisted state, queue, manager, receipt owner, or compatibility shim.

## Tasks

1. Replace route proof-version validation with narrow body bounds.
2. Add wired v4 client/route Preview-to-Apply regressions and retain malformed,
   missing, extra, altered, and stale proof cases.
3. Carry the verified in-lock provider subscription into cancellation and
   delete the redundant cleanup retrieve for this caller.
4. Add request-count/ordering and bounded-envelope regressions while retaining
   all drift and current-owner protections.
5. Run required re-audits and verification, finish the scoped commit, push,
   update the PR contract, wait for exact-head CI, and merge.

## Decisions

- Accept both Round 10 findings. The route and service own incompatible proof
  versions, and provider recovery performs three individually bounded calls
  inside a transaction budget that can accommodate only two.
- Do not replace `v3` with `v4` at the route. Delete route semantic ownership
  so future service proof-version changes cannot split the wired contract.
- Apply the same deletion to the candidate snapshot digest after the completion
  audit found that its route-side `v4` regex duplicated the service's existing
  exact recomputation and comparison.
- Do not weaken cleanup checks or move cancellation outside the member lock.
  Carry the exact disposition already obtained by the final in-lock read.
- Bind the shared provider inspection predicate to the expected Stripe customer
  before it can produce a cleanup disposition.
- No persisted state, queue, compatibility shim, proof abstraction, or provider
  snapshot was added; the final path removes one provider request.

## Verification

- Focused Round 10 regressions — 4 files / 173 tests passed.
- `pnpm --filter @murphai/hosted-web typecheck` — passed.
- `pnpm test:diff apps/web` — passed: dependency/boundary/runtime guards,
  dev smoke, production build/typecheck, lint with 0 errors and 11 unrelated
  warnings, 381 test files passed and 1 skipped, 4,468 tests passed and 135
  skipped.
- Required final coverage, security/privacy/correctness, and
  completion/simplicity re-audits — clean after the final opaque-digest change.
- `git diff --check` and sensitive-identifier scan — clean.
- ReviewGPT hard cap honored: no round 11.
- Exact-head GitHub CI and merge — pending.
Completed: 2026-07-13
