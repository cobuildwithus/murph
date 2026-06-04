# Experiment Onboarding Dedupe

## Goal

Shrink Health Commons experiment onboarding so protocol content stores only
protocol-specific onboarding deltas instead of duplicating plan defaults,
logging fields, safety stop rules, vault-read hints, and generic assistant
policy.

Success means authored onboarding blocks are materially smaller, the assistant
can still recover the important model-facing setup/safety context from
canonical protocol/test-plan/safety fields, and tests guard against the old
duplicate structure returning.

## Scope

- Update the Health Commons onboarding contract and catalog validation/hash
  behavior.
- Migrate authored protocol onboarding content to the compact shape.
- Update assistant onboarding instructions and durable product docs.
- Add tests or guards that prevent reintroducing duplicate onboarding fields.
- Preserve unrelated active reset-script and CLI output-reduction edits.
- Avoid touching `packages/cli` unless the schema migration requires it.

## Plan

1. Inspect current schema, catalog consumers, generators, and content shape.
2. Define a compact onboarding schema that keeps only durable deltas.
3. Migrate protocol content and any canonical cadence fields needed for
   derivation.
4. Update assistant skill/docs to derive generic behavior from canonical fields.
5. Update tests and add dedupe/size guardrails.
6. Run package verification, required audits, and finish through the repo task
   closeout path.

## Verification

- `pnpm --dir packages/contracts verify`
- `pnpm --dir packages/health-commons verify`
- `pnpm --dir packages/cli test:source`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/experiment-onboarding-skill-guidance.test.ts`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff`
- Parsed migration guard:
  - 29 current onboarding blocks checked.
  - No legacy `contextReview`, `logging`, `assistantPolicy`, duplicated plan defaults, legacy setup-slot metadata, safety `why`, or safety inheritance fields remain in onboarding.
  - Current `protocol.sessionFieldIds` exactly match the old v1 `experimentOnboarding.logging.sessionFields` for all 29 migrated protocols.
  - IT-band onboarding JSON is 5,256 bytes.
- Completion audits:
  - Security/privacy: no actionable issues.
  - Simplify/task-finish reviews found and drove fixes for compact canonical protocol output, stable session/confounder IDs, selected-test-plan adherence precedence, and stable-ID uniqueness constraints.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
