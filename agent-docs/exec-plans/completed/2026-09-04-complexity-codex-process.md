# Collapse repeated Codex final-response selection

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Delete repeated final-response selection and event guards in the existing
  Codex process-turn owner without changing replies, authority, or lifecycle.

## Success criteria

- Reduce source and measured complexity with no new owner or abstraction.
- Preserve retained and promoted replies, media/card fallback, no-reply scopes,
  first-notification timing, and event/callback order.
- Pass focused runtime proof, typecheck, a reviewed real-Codex journey, parent
  candidate review, exact-head CI, and final ReviewGPT.

## Scope

- In scope: final candidate projection and accepted-event guard duplication in
  assistant-codex.ts; focused regression and live verification.
- Out of scope: tool execution/serialization, prompts, provider protocols,
  process state or lifecycle changes, and open PRs #2485 and #2629.

## Constraints

- Technical constraints: retain ordering, callbacks, original candidate text,
  error handling, and existing nullish fallback semantics; no new state owner.
- Product/process constraints: internal refactor, Product UX not applicable.
  Preserve an earlier answer when a later acknowledgement requests silence,
  retain trailing attachments, and keep suppressed progress quiet. Use only
  synthetic proof; parent reviews actual replies. Keep the PR open after gates.

## Risks and mitigations

1. Risk: factoring response selection loses an earlier response or leaks a
   suppressed response into the latest accepted input.
   Mitigation: prove full promotion control flow and exact output/context
   assertions for text, media, cards, card fallback, and later no-reply.
2. Risk: event simplification overwrites the first timestamp or skips callbacks.
   Mitigation: duplicate-notification timing and existing runtime event suites.

## Tasks

1. Completed: inspect baseline, current docs/Frog, and exact open-PR hunks.
2. Completed: strengthen deterministic and live proof before source edits.
3. Completed: collapse duplicate selection/guards and pass focused verification.
4. Completed: run focused real Codex, inspect actual output, and measure complexity.
5. Delivery: scoped commit, draft PR, and parent candidate review.
6. External gates: Ready, full exact-head ReviewGPT concurrently with CI, handoff.

## Decisions

- The final candidate is already cleared by promotion whenever the latest
  context chooses no reply. Repeating that predicate for each projected field
  is redundant; only the distinct earlier-no-reply suppression remains.
- Keep the raw candidate used for final-message selection unchanged.
- PR #2485 modifies required-response overlays and rendering after this
  projection; #2629 modifies later tool classification. Proposed hunks avoid
  both, and their branches remain untouched.
- Graft is unavailable; use bounded baseline reads as authorized by the parent.

## Verification

- PASS: `pnpm --dir packages/assistant-engine exec vitest run
  test/assistant-codex-runtime-steering.test.ts
  test/assistant-codex-runtime-turns.test.ts
  test/assistant-codex-runtime-events.test.ts
  test/assistant-codex-runtime-tools.test.ts
  test/assistant-codex-runtime-config.test.ts
  test/assistant-codex-runtime-process.test.ts --no-coverage` — 247 tests.
- PASS: `pnpm --filter @murphai/assistant-engine typecheck` and `git diff --check`.
- PASS: `pnpm complexity:diff` — debt 244 to 229; main turn function 113 to
  102; accepted-event handler 67 to 63; production source net deletion 34 lines.
- PASS: `pnpm test:assistant:live -- --test 'keeps the earlier answer and stays
  quiet for the later acknowledgement'` with an authenticated alternate local
  subscription home and gpt-5.6-terra. The original synthetic answer remains in
  context 0; context 1 is quiet, with exactly one finish-without-reply call,
  no extra tools, no final/provider/transcript text, and no media/card.
  Actual reply reviewed Ready; no production credentials or effects.
- Parent candidate review, exact-head CI, and final ReviewGPT remain PR
  admission/delivery gates, recorded with the final immutable head in PR evidence.
Completed: 2026-09-04
