# Norwegian 4x4 onboarding cleanup patch landing

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the supplied Norwegian 4x4 onboarding cleanup patch on current HEAD without widening beyond the protocol onboarding contract, assistant guidance, directly coupled tests, and regenerated Health Commons catalog outputs.

## Success criteria

- Norwegian 4x4 onboarding uses smaller reusable vault checks with corrected command hints.
- Assistant guidance resolves protocol pages first, treats read hints as hints rather than automation, and preserves protocol revision metadata when writing richer runs.
- Experiment-onboarding specs and tests cover reusable read hints plus `runSpecRevisionId` semantics for onboarding-contract changes.
- Directly coupled Health Commons generated artifacts are regenerated from current authored sources rather than replayed from stale patch hunks.

## Scope

- In scope:
- `agent-docs/product-specs/experiment-onboarding.md`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- directly coupled `packages/assistant-engine/test/system-prompt.test.ts`
- `packages/contracts/test/health-commons-experiment-onboarding.test.ts`
- `packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md`
- `packages/health-commons/test/catalog.experiment-onboarding.test.ts`
- `packages/openclaw-plugin/skills/murph/SKILL.md`
- directly coupled `packages/health-commons/generated/**` outputs
- Out of scope:
- unrelated hosted typing, hosted usage, or broader Norwegian evidence/source changes already present in this checkout
- any non-requested onboarding behavior changes outside the supplied patch intent

## Constraints

- Technical constraints:
- Treat the supplied patch as intent on top of current HEAD; merge authored hunks manually where generated artifacts or adjacent lines have drifted.
- Preserve `protocolRef.key`, `pageRevisionId`, `runSpecRevisionId`, and `testPlanId` semantics in assistant guidance and tests.
- Product/process constraints:
- Preserve overlapping in-flight Health Commons and onboarding work outside this narrow slice.
- Keep generated catalog updates limited to the coupled Norwegian onboarding changes.

## Risks and mitigations

1. Risk: Replaying stale generated hunks could overwrite newer catalog state.
   Mitigation: Apply only authored source/spec/test changes manually, then regenerate the required generated files from the current tree.
2. Risk: Assistant-guidance edits could drift from the current CLI surface or duplicate repo rules.
   Mitigation: Inspect current command references before editing and verify the resulting prompt/test/spec wording together.

## Tasks

1. Register the landing and inspect current target files against the supplied patch.
2. Merge the authored onboarding/spec/prompt/test changes onto current HEAD.
3. Regenerate the directly coupled Health Commons catalog files and verify the resulting diff stays narrow.
4. Run truthful verification for the touched packages plus required completion audits.
5. Commit only the landed files plus plan/ledger updates through the repo completion flow.

## Decisions

- Use a dedicated active plan because the landing is multi-file, supplied as a stale patch, and overlaps current Health Commons activity.
- Regenerate the Health Commons catalog instead of forcing stale generated hunks from the supplied patch.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff agent-docs/product-specs/experiment-onboarding.md packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/system-prompt.test.ts packages/contracts/test/health-commons-experiment-onboarding.test.ts packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md packages/health-commons/test/catalog.experiment-onboarding.test.ts packages/openclaw-plugin/skills/murph/SKILL.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson`
- `pnpm test:smoke`
- Expected outcomes:
- Typecheck passes, the diff-aware lane truthfully covers the touched owners, smoke stays green, and the regenerated Health Commons outputs reflect the onboarding cleanup without unrelated churn.
Completed: 2026-04-22
