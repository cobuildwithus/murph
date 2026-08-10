# PR 1481 direct-route admission correction

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Resolve the accepted PR 1481 ReviewGPT finding by rejecting a private
  current-sender continuation before personal Assistant Ask work starts when
  the exact sender has no current same-channel direct Murph route.

## Success criteria

- Fresh and replayed requests fail closed before mailbox handoff when no
  current same-channel direct-member destination exists.
- The unavailable result gives the group Murph one precise recovery action:
  ask the sender to open a direct Murph chat on that channel and retry.
- Existing completion-time and provider-entry authority checks remain intact.
- Focused tests and typechecks pass, the preliminary specialist result is
  resolved, final ReviewGPT reaches `ROUND_OUTCOME: PASS`, exact-head CI is
  green, and GitHub reports a clean merge path.

## Scope

- In scope: the existing Web admission/replay owner, focused Web and Assistant
  Engine coverage, the group-tool recovery instruction, PR evidence, ReviewGPT,
  CI, and mergeability proof.
- Out of scope: new persisted state, provider routing changes, group fallback,
  first-contact messaging, a second model generation, deployment, or merge.

## Tasks

1. Add the current direct-destination check to fresh and replay admission.
2. Add focused regression proof for an authenticated Telegram group sender
   without a direct thread and for the model-facing recovery instruction.
3. Run focused verification and inspect the complete corrected candidate.
4. Commit and push the candidate, run the missing preliminary specialist pass,
   final ReviewGPT round 2, and exact-head CI, then resolve any accepted issue.
5. Complete the parent final review, close this plan, push the final head, and
   prove mergeability without merging the PR.

## Verification

- `apps/web` focused Vitest: 167/167 passed across current-sender admission,
  private completion, group-tool dispatch, and signed route coverage.
- `packages/assistant-engine` focused Vitest: 93/93 passed across the exact
  current-sender model boundary and group-tool catalog/dispatch coverage.
- `apps/web` and `packages/assistant-engine` package typechecks passed.
- Scoped Web ESLint passed; Assistant Engine has no package lint script and is
  covered by its typecheck and focused Vitest lane.
- `git diff --check` and the added-lines identifier/secret scan passed.
- Exact-head Linux CI measured the intended dynamic-tool recovery projection at
  9,927,719B total runner output, 7,510B above the previous ceiling. The
  forbidden startup-input guard passed. A clean macOS production assembly then
  measured 9,974,661B total and a 7,997,170B static closure; both baselines are
  ratcheted to the higher exact cross-platform measurements while retaining the
  established 32KB and 96KB allowances. The focused budget test passed 42/42,
  and the assemble-only production probe passed with a 1,672,790B entry,
  7,997,170B static closure, and 9,974,661B total output plus a successful boot
  probe. The Cloudflare package typecheck passed. A scoped root ESLint attempt
  could not run because this workspace has no root `eslint` binary and the
  Cloudflare package exposes no lint script; typecheck and focused Vitest cover
  the changed TypeScript.
- The first preliminary specialist attempt was tooling-invalid: it returned a
  completion marker after 77 seconds, below the required five-minute credibility
  floor. Its result is untrusted and does not count; retry the same pass on the
  corrected exact head using the retained review thread.
- Preliminary specialist ReviewGPT, final ReviewGPT round 2, exact-head CI,
  parent final review, and clean-merge proof remain pending.
