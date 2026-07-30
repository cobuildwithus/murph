# Temporal Deployment Owner Handoff

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Move checked-in production Temporal deployment ownership from public Murph to
  private Murph Cloud without changing or interrupting the running worker.

## Success criteria

- Public Murph no longer contains the Render Blueprint or deploy-hook workflow.
- Public Murph continues to contain the current worker implementation as a
  rollback reference until the private deployment is proven in production.
- Public tests prevent the private deployment owner from drifting back.
- Durable security, verification, testing, and Temporal ownership docs describe
  the one-way public/private boundary.
- The private cross-repository Temporal integration check passes before this
  handoff merges.

## Scope

- In scope:
  - Delete the public Render Blueprint and deploy workflow.
  - Remove public tests that inspect private deployment configuration.
  - Add a public absence guard and update live ownership documentation.
- Out of scope:
  - Runtime, Workflow, Activity, signal, schedule, task-queue, or contract
    behavior changes.
  - Render service mutation or private deployment enablement.
  - Removing the public Temporal implementation.

## Constraints

- Technical constraints:
  - Preserve the existing Render service, Temporal namespace, task queue,
    Workflow and signal names, Schedule id, and patch marker.
  - Keep the public worker implementation buildable and tested for rollback.
- Product/process constraints:
  - Do not merge before the private integration check is green.
  - Do not copy, print, or move production secret values.
  - Use a PR and exact-head CI for the public change.

## Risks and mitigations

1. Risk: Public deployment triggers continue after Render connects to the
   private source repository.
   Mitigation: Remove the public deploy workflow before the provider source
   cutover and wait for already-started public deploy runs to finish.
2. Risk: Repository relocation is mistaken for the completed legacy hard cut.
   Mitigation: State explicitly that current histories remain valid and source
   relocation uses rolling replacement.
3. Risk: Removing deployment files also removes the worker rollback source.
   Mitigation: Keep the public package and its runtime tests unchanged except
   for the Render-specific configuration assertion.

## Tasks

1. Add and merge the private cross-repository readiness check.
2. Remove the public deployment configuration and its deployment-specific
   assertions.
3. Add the public absence guard and update current ownership docs.
4. Run focused tests, architecture guards, preliminary ReviewGPT, final review,
   and exact-head CI.
5. Merge only after the private prerequisite and public gates are green.

## Decisions

- Keep the production service and Temporal identities unchanged.
- Keep the public implementation until private production proof completes.
- Treat Murph Cloud as the sole checked-in production deployment owner.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/crabbox/trusted-verification-entrypoint.test.ts`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-workflow-cache-guards.test.ts`
- `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/worker.test.ts`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/production-migration-guard.test.ts`
- `pnpm hosted-temporal:guard`
- `pnpm docs:drift`
- Expected outcomes: focused suites and guards pass; private integration and
  public exact-head CI are green before merge.
Completed: 2026-07-30
