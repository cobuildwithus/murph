# Align Murph Age CLI schemas with current wearable residual types

Status: completed
Created: 2026-05-24
Updated: 2026-05-24

## Goal

- Restore green repo typecheck/test-diff by aligning the `age` CLI command schemas with the current Murph Age wearable residual and layered-research contract types.

## Success criteria

- `packages/cli` typecheck accepts the current health-metrics Murph Age return types.
- Root `pnpm typecheck` and `pnpm test:diff` pass.
- Hosted-local E2E proof for the recent hosted trust-boundary changes runs successfully.

## Scope

- In scope:
- `packages/cli/config.schema.json`
- `packages/cli/src/commands/murph-age.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/test/murph-age-command.test.ts`
- `apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts`
- Focused CLI and root verification.
- Out of scope:
- Murph Age scoring logic changes.
- Product authorization, model math, or research artifact changes.

## Constraints

- Keep the fix schema-only and composable.
- Do not expose local paths, raw payloads, private identifiers, secrets, coefficients, or submitted row values.
- Preserve existing safe product defaults; this is only a contract-alignment fix.

## Risks and mitigations

1. Risk: broadening schemas could accidentally authorize product display or score contribution.
   Mitigation: keep all product authorization and score contribution literals unchanged.
2. Risk: CLI schemas drift again from health-metrics types.
   Mitigation: use shared enum-style schema primitives for wearable residual ids and research layer ids.

## Tasks

1. Align wearable residual id/family schemas and layered research schemas with current health-metrics types.
2. Regenerate CLI config-schema artifacts.
3. Run focused CLI typecheck.
4. Stabilize scheduled-reminder hosted-local E2E timing if direct E2E proof exposes a local timing race.
5. Run root repo checks and hosted-local E2E proof.
6. Run required completion review and close through `scripts/finish-task`.

## Verification

- Passed:
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/cli test -- murph-age-command.test.ts`
  - `pnpm typecheck`
  - `pnpm --dir packages/cli verify:package-shape`
  - `pnpm --dir apps/cloudflare typecheck`
  - Serialized `pnpm verify:acceptance`
  - `apps/cloudflare verify` inside `pnpm test:diff`, including hosted-local stub-all E2E.
  - `pnpm hosted-local e2e linq-scheduled-reminder --no-bundle`
- Blocked/unrelated:
  - `pnpm test:diff` failed in unrelated dirty `apps/web` hosted onboarding/device-sync Prisma mock tests.
Completed: 2026-05-24
