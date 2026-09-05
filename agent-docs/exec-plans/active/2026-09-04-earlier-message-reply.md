# Preserve earlier accepted native reply targets

Status: active
Created: 2026-09-04
Updated: 2026-09-05

## Goal

- Keep native replies attached to the intended earlier message when several
  authorized messages join one active assistant turn.

## Success criteria

- Native reply selection and dispatch accept an earlier same-conversation
  message already admitted through the selecting delivery-context ordinal.
- Future-ordinal, cross-turn, missing, unsupported and foreign-route references
  fail closed; reactions retain their existing scope.
- Focused deterministic and real-assistant proof, typecheck, parent review,
  scoped commit and exact-head external review establish the candidate.

## Scope

- In scope: accepted-message selection in local-service, progress/preceding/final reply
  revalidation, directly affected tests and current targeting documentation.
- Out of scope: admission eligibility, reaction policy, new delivery owners,
  schemas, historical transcript targeting, production mutation and deployment.

## Constraints

- Reuse the existing bounded accepted-input prefix; retain canonical event
  reloads and conversation, provider, audience, account and thread checks.
- Obtain a concrete implementation patch through managed ReviewGPT, inspect it
  locally, and coordinate one heavy test command at a time with the parent.
- Use synthetic evidence only. Keep review artifacts ignored.

## Risks and mitigations

1. A stale response could target input admitted after its ordinal. Preserve
   prefix ordering and cover concurrent live-steering admission explicitly.
2. Selection could outlive target authority. Re-resolve the stored event at
   dispatch and prove missing or changed targets cause no provider send.
3. Group reconsideration offsets could widen or lose authority. Verify the
   provider-request base ordinal and preserve selected-response accounting.

## Tasks

1. Trace membership, live-steering checkpoints, route checks and delivery owners.
2. Obtain ReviewGPT implementation diff; apply and critique its narrow scope.
3. Prove earlier targets, earlier/future ordering, dispatch revalidation and
   unchanged reaction boundaries; run focused typecheck and assistant journey.
4. Update current owner docs and member release note, inspect complete diff,
   obtain parent candidate review, commit and open a draft PR.
5. Run final ReviewGPT on the stable pushed head alongside required CI; hand
   findings to the parent and retain the worktree without merging or deploying.

## Decisions

- Source trace: native-reply authorization and both preceding/final delivery
  rechecks use segment-only IDs. The existing cumulative helper already serves
  participant effects. The shared message-target resolver needs no weaker check.
- ReviewGPT implementation uses a guarded snapshot whose affected source and
  tests match the worktree base; final review will use the pushed candidate.
- The verified configured ReviewGPT model returned an applicable unified diff,
  14 deterministic scenarios and an opt-in model journey. Local review retains
  its bounded native-reply helper: invalid ordinals cannot use the accounting
  helper's out-of-range fallback or become valid through reconsideration rebasing.
- Local proof also prints the synthetic model reply for the required UX review;
  the external implementation environment could not run repository dependencies.

## Product UX

- Outcome: a reply can remain linked to an earlier request after a later message
  arrives in the same active exchange.
- Reaches: supported private and authenticated group iMessage/Telegram routes;
  ordinary flat replies and reaction scope remain unchanged.
- Proof: synthetic live admission through selected reply dispatch, denied
  future/foreign/deleted targets, and a focused production-derived model turn.

## Verification

- Selected Telegram group regression: failed against unchanged production and
  passed with the patch. An initial filter skipped every test and is excluded
  from evidence.
- `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/assistant-engine exec vitest run
  --config vitest.config.ts --no-coverage
  test/assistant-local-service-native-reply-prefix.test.ts
  test/assistant-message-target-selection.test.ts`: 35 passed. Covers both
  providers and audiences, admission checkpoint ordering, preceding/final
  revalidation, invalid ordinals, reconsideration and unchanged reaction scope.
- `pnpm --dir packages/assistant-engine typecheck`: passed again after the final fixture correction.
- `pnpm complexity:diff --base 18b498bc49435c49adb99588754a8a2bf72c4ce6`:
  passed. Existing local-service debt decreased 154 to 153 and maximum 131 to
  130. Existing orchestration hotspots need no unrelated extraction for this fix.
- `pnpm test:assistant:live -- --test 'real Codex live native reply prefix e2e'`:
  passed with the local subscription and `gpt-5.6-terra`. The synthetic user
  explicitly waits for a clarification: exactly one earlier-ref selection at
  ordinal 1, no preceding answer, correct concise final answer, no internal ref
  leakage. Reply review: Ready. The initial fixture allowed an answer before
  clarification; it was corrected without weakening the no-duplicate assertion.
- Parent inspected the production diff and requested no source remediation.
- `MURPH_VITEST_MAX_WORKERS=1 MURPH_APP_VITEST_MAX_WORKERS=1 pnpm --dir
  apps/web test -- changelog-page.test.tsx`: nine server-rendering tests passed.
- Current-main merge-tree proof is clean; no base rebase was needed.
- Remaining: Web typecheck, exact-head final ReviewGPT and required CI, then
  parent completion review.
