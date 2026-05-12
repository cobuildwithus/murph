# Hosted web Workflow local data dir

Status: completed
Created: 2026-05-13
Updated: 2026-05-13

## Goal

- Stop local hosted onboarding Workflow retries from drifting across the hosted web dev artifact boundary by aligning Workflow local-world storage with the configured Next dist directory.

## Success criteria

- Hosted web Next config sets `WORKFLOW_LOCAL_DATA_DIR` to `<distDir>/workflow-data` for local Workflow worlds.
- Explicit non-local Workflow worlds and explicit data-dir overrides remain untouched.
- Focused hosted web config tests cover the contract.

## Scope

- In scope:
  - `apps/web/next.config.ts`
  - Hosted web config tests.
- Out of scope:
  - Cloudflare runner egress policy changes.
  - Workflow SDK package patches.
  - Hosted onboarding product-flow changes.

## Constraints

- Technical constraints:
  - Preserve Workflow SDK production/Vercel behavior.
  - Keep the fix compatible with `.next-dev`, `.next-smoke`, and `.next` dist modes.
- Product/process constraints:
  - Preserve unrelated working-tree edits and active hosted runner plan work.

## Risks and mitigations

1. Risk: Overriding a deliberately configured local Workflow data dir.
   Mitigation: Only replace the SDK's default `.next/workflow-data` value or an unset value.
2. Risk: Accidentally changing Vercel Workflow behavior.
   Mitigation: Skip configuration when `VERCEL_DEPLOYMENT_ID` is present or the target world is explicitly non-local.

## Tasks

1. Add a hosted web helper that derives Workflow local data dir from `resolveHostedWebDistDir`.
2. Call it from the Next config callback before returning the Next config.
3. Add focused tests for dev, smoke, explicit override, non-local world, and Vercel cases.
4. Run focused verification and inspect the diff for accidental identifier leakage.

## Decisions

- Treat the Cloudflare open-internet passthrough warnings as a separate, intentional egress audit signal; do not change runner egress in this plan.

## Verification

- Commands to run:
  - `pnpm exec vitest run apps/web/test/next-config.test.ts apps/web/test/next-config-workflow.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
  - `pnpm --dir apps/web exec eslint next.config.ts test/next-config.test.ts test/next-config-workflow.test.ts`
  - `bash scripts/workspace-verify.sh test:diff apps/web/next.config.ts apps/web/test/next-config.test.ts apps/web/test/next-config-workflow.test.ts`
- Outcomes:
  - Focused Vitest command passed: 2 files, 31 tests.
  - Scoped lint over touched files passed.
  - Diff-aware verification passed dependency policy, workspace boundary checks, hosted stale-name guard, raw health log guard, hosted web legal PDF generation, Prisma generation, Health Commons generation, dev smoke, full hosted-web Vitest, and Next build. It failed at hosted-web lint because of pre-existing unrelated React lint violations outside this plan's files.
Completed: 2026-05-13
