# Remove group cardinality cliffs while preserving bounded work

Status: completed
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Return up to 64 lightweight visible group labels when a request needs target
  clarification, while keeping explicitly named resolution uncapped and the
  heavier membership-summary payload at its existing bound.
- Raise the stable assistant route-prompt ceiling by exactly 5%, rounded up,
  for the reviewed cross-tool group-routing guidance.
- Keep heavy membership and disclosure payloads bounded per page while making
  every later membership and active grant reachable through stable cursors.
- Remove lifetime permission/grant admission caps and correct bounded
  maintenance work that could falsely report completion after row 25.
- Replace the vault-share destination admission cap with bounded continuation
  so mandatory profile sharing cannot roll back a member's 26th group join.

## Success criteria

- Unnamed clarification admits 64 de-duplicated labels and rejects 65 at the
  hosted-execution parser boundary.
- The Web owner reads at most 65 rows for unnamed clarification and emits at
  most 64 labels; exact named resolution still reads every current membership.
- Full membership summaries and disclosure projections remain 25-row pages;
  exact server cursors reach all later rows and malformed cursors fail clearly.
- Disclosure permission and grant history has no lifetime or active admission
  cap; exact authority and replay checks remain unchanged.
- Vault-share delivery processes at most 25 destinations per callback and
  converges through stable continuation without weakening generation or
  workspace fencing.
- The prompt cache-stability ceiling is 62,374 characters and the current composed
  prompt stays below it.
- Focused deterministic checks, the real-Codex journey, ReviewGPT, and required
  exact-head CI pass.

## Decisions

- Add one label-specific contract constant instead of increasing the existing
  membership-summary constant, because the latter also owns permission and
  share payload cardinality.
- Do not change matching, ambiguity, authority, replay, or fan-out behavior.
- The 5% prompt increase is explicit product authority, not an invitation for
  capability-specific guidance to enter the always-on layer.
- Treat 25 as a page/work budget, never as authorization or lifetime product
  capacity. Do not blindly raise heavy payload or delivery constants to 64.
- Preserve independent membership and disclosure cursors because advancing one
  collection must not skip the other.
- Treat a cursor chain as exhausted for the current turn after its null next
  cursor; paging the other collection must not restart the exhausted chain.
- Preserve vault generation tokens, source-workspace fences, deadlines, and
  exact-generation checks while restoring destination pagination. A generation
  change after a partial page must defer the whole obligation, never acknowledge
  the already-delivered prefix as complete.

## Verification

- Hosted Web target-admission Vitest.
- Membership/disclosure store and tool pagination Vitest, including row 26,
  malformed cursors, and post-revocation history.
- Vault-share store/route/Cloudflare continuation and PostgreSQL index proof.
- Hosted Execution Assistant Ask parser Vitest.
- Assistant prompt/cache-stability Vitest and Assistant Engine typecheck.
- Focused real-Codex named handoff and independent dual-cursor journeys with
  exact tool-call assertions and reply review.
- Diff/privacy checks, ReviewGPT correction round, and required PR CI.
Completed: 2026-08-27
