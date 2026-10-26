# Recover finalized device callback returns without claiming failure

Status: active
Created: 2026-10-26
Updated: 2026-10-26

## Goal

Use the existing neutral Connect recovery when a proof-verified callback has no
remaining admission. Never infer success from unavailable state. Keep provider,
member, browser proof, consumption and cleanup ownership unchanged.

## Evidence and owner

The hosted connection store deletes the exact consumed OAuth claim in the
connection persistence transaction. A later callback then reaches shared ingress
as missing and throws OAUTH_STATE_INVALID, which the Web route currently reports
as connection failure. The route and Connect notice are the presentation owners.
No new connection read, replay ledger, credential lifetime or state owner is needed.
A missing claim does not distinguish completed, expired or otherwise absent state;
this patch preserves that uncertainty and code in bounded diagnostics.

## Product UX

- Outcome: review current connected-source cards without a false failure claim.
- Reaches: proof-valid unavailable admissions, including completed and expired
  returns; unknown state never gains success or provider authority. Invalid proof,
  foreign owner/provider, fresh success and actual provider failure retain their
  distinct paths. No automatic reconnect or customer message.
- Proof: failing-before route/email and rendered Connect tests, exact finalization
  store test, unchanged proof/mismatch/provider-failure regression coverage, and
  inspection of the existing neutral production component.

## Scope and constraints

Web callback presentation, existing finite diagnostics, focused tests, owner docs
and one public-safe changelog entry. No database, runtime, private-worker or
provider mutation. No production replay or account repair. Existing browser,
review and data-sharing holds remain. Public artifacts contain synthetic evidence.

## Tasks

1. Reproduce finalized admission return and false failure presentation.
2. Route proof-verified unavailable state to neutral recovery with its exact code.
3. Verify proof, owner, provider and successful connection boundaries; typecheck.
4. Candidate review; scoped commit and draft PR; required exact-head CI/review.
5. Coordinate any release only after gates; verify passively afterward.

## Verification

Before implementation: callback route and Connect tests failed on the expected
email/notice assertions (2 failing, 124 passing). Dependencies installed from the
frozen lockfile in the isolated worktree. Final focused proof: 157 tests pass across callback route, Connect rendering,
OAuth session store, browser proof and alert suites. Web typecheck and complexity
guard pass with no changed function above 20. Local Node is 24.14.1; exact-head
CI must supply the repository-pinned Node 24.22.1 proof. The production design
catalog neutral notice was visually inspected; no markup or style changed.
Candidate review preserves proof/member/provider authority and reports no
connection outcome from unavailable state. Required final review, CI and
coordinated release remain pending.
