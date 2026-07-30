# progress-card-multi-obligation-remediation

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Preserve every independent reply-required recovery obligation created before
  a later final response, including obligations owned by different steered
  message targets.

## Success criteria

- Finalization materializes all unresolved reply-required ordinals in
  chronological order through the selected final context.
- Each recovery uses only its own ordinal's text, media, and reply target.
- Blank earlier recoveries receive the existing neutral fallback text.
- Model-authored earlier recovery text remains required before the later final.
- Existing single-recovery, no-reply, media ownership, and exact predecessor
  behavior remain unchanged.
- Focused tests, package typechecks, required audits, exact-head CI, and the
  final ReviewGPT gate pass on the existing PR branch.

## Scope

- In scope:
  - Assistant Codex final-response materialization.
  - Focused regressions for multiple steered recovery obligations.
  - Reuse of the existing required-before-final outbox sequence.
- Out of scope:
  - New persistence, queues, delivery managers, or schema fields.
  - Changes to unrelated open PRs or deployment.

## Constraints

- Technical constraints:
  - Preserve ordinal-local text, media, and target ownership.
  - Keep materialized required segments chronologically ordered.
  - Reuse the existing predecessor-chain enforcement for downstream dispatch.
- Product/process constraints:
  - Continue PR #1102 and its existing worktree; do not create a duplicate PR.
  - Preserve unrelated working-tree work.
  - Use the PR-lane ReviewGPT gate rather than a local deep review.

## Risks and mitigations

1. Risk: Broadly marking output required could promote unrelated content.
   Mitigation: Collect only explicit reply-required ordinals and preserve the
   existing bounded interval rule through the later selected final.
2. Risk: Recovery text or media could move to a later steered target.
   Mitigation: Resolve the segment and reply target by the obligation's own
   delivery-context ordinal and assert distinct-target behavior.
3. Risk: Duplicate local/hosted coverage could obscure the actual regression.
   Mitigation: Add the Codex finalization regressions and rely on existing
   exact-chain dispatch tests unless a concrete downstream gap is found.

## Tasks

1. Prove the singular selection root cause and define the ordinal collection.
2. Implement all-obligation recovery materialization.
3. Add focused distinct-target and model-authored recovery regressions.
4. Run scoped tests, typechecks, repository checks, and targeted audits.
5. Commit and push the same PR, verify exact-head CI, and run ReviewGPT
   remediation rounds to a clean result.

## Decisions

- Keep final-action patches as the existing per-ordinal source of truth for
  no-reply and vault-file ownership.
- Track genuine reply-required origins in an independent turn-local ordinal set
  because a successful vault-file patch may carry an earlier requirement
  without creating a new one.
- Do not add a second ordering mechanism; required segments feed the existing
  persisted exact-predecessor chain.

## Verification

- Commands to run:
  - Focused and full `assistant-codex-runtime` tests.
  - Assistant engine/runtime/operator typechecks and affected outbox/hosted
    regressions.
  - Diff, documentation drift, privacy, and forbidden-cast checks.
  - Exact-head GitHub Actions and ReviewGPT remediation review.
- Expected outcomes:
  - Both independent recoveries remain required on their original targets and
    precede the later final.
  - All scoped and remote checks pass with no new review finding.
- Local results:
  - The three focused regressions passed.
  - The full assistant Codex runtime suite passed 248/248.
  - Assistant-engine typecheck and diff hygiene passed.
  - Two independent targeted static audits found no reachable regression.
Completed: 2026-07-30
