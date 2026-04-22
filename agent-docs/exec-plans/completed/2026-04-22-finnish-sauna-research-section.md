## Goal

Land the UI-only Finnish sauna research-section polish as a narrow hosted-web rendering update without adding any renderer fallback or legacy behavior.

## Scope

- `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx`
- directly coupled `apps/web/test/**` only if the current branch needs focused expectation updates or added proof

## Constraints

- Do not widen into Health Commons content, schema/contracts, or `experiment-detail.ts` fallback logic.
- Preserve overlapping or pre-existing edits in shared experiment-detail files if they appear while landing the patch.
- Keep grouped-research rendering strict; this pass is presentation only.

## Verification

- Prefer `pnpm test:diff <path ...>` for the touched `apps/web` slice if it is truthful in this checkout.
- Run `pnpm typecheck` unless the environment blocks it for unrelated setup reasons.
- Add focused direct proof for research-group presentation if automated coverage leaves a gap.
Status: completed
Updated: 2026-04-22
Completed: 2026-04-22
