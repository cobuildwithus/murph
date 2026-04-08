# Land downloaded security audit patch

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Land the applicable parts of the downloaded security-audit patch so assistant JSON payload staging no longer writes durable derived files and hosted execution error paths stop echoing raw response bodies into logs or surfaced errors.

## Success criteria

- Assistant canonical-write tools stage payload JSON under `vault/.runtime/tmp/assistant/payloads` with private temp permissions and clean it up after use.
- Hosted execution request helpers and Stripe metering stop appending response bodies to thrown errors on the landed paths from the downloaded patch.
- The touched package and app tests/typecheck lanes pass, or any unrelated pre-existing blocker is identified precisely.

## Scope

- In scope:
- Port the downloaded patch intent into the live equivalents under `packages/assistant-engine`, `packages/hosted-execution`, `packages/cloudflare-hosted-control`, `apps/web`, and, if conflict-safe, the narrow `apps/cloudflare` files from the artifact.
- Out of scope:
- New audit findings beyond the downloaded artifact.
- Legacy cleanup of already-written assistant payload files under old derived paths.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-worktree edits, especially the ongoing assistant-engine packaging work and the active exclusive Cloudflare packaging lane.
- Keep changes scoped to the downloaded artifact intent rather than broadening into a fresh security sweep.
- Product/process constraints:
- Follow the high-risk repo workflow: ledger, active plan, required verification, mandatory final audit review, and scoped commit.

## Risks and mitigations

1. Risk: The patch overlaps files with active unrelated worktree edits.
   Mitigation: Read current file state first, merge narrowly, and avoid reverting or reformatting unrelated changes.
2. Risk: The Cloudflare artifact slices may conflict with the active exclusive hosted-runner lane.
   Mitigation: Keep those edits minimal and only land them if the live files remain independent; otherwise report them as scoped omissions.

## Tasks

1. Register the task in the ledger and capture the bounded patch-landing plan.
2. Port the applicable assistant payload temp-file changes and response-body redaction changes into the live tree.
3. Update or add focused tests for the landed behavior.
4. Run required verification and a final audit review, then commit the touched files with the plan artifact.

## Decisions

- Treat the downloaded patch as intent, not authority: port only the applicable security deltas into the current tree.
- Reuse existing hosted-execution and hosted-web tests where they already cover the changed error paths instead of creating unnecessary duplicate test files.
- After audit review, harden temp payload staging cleanup so a write failure after `mkdtemp()` still removes the temp directory before rethrowing.
- Add direct `packages/cloudflare-hosted-control` coverage rather than relying only on higher-level web mocks for that client boundary.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- Focused app-web test commands for the changed hosted-execution and Stripe metering paths if the package lane does not cover them.
- Expected outcomes:
- Green verification for the touched package/app surfaces, or clearly separated unrelated blockers with evidence.

## Outcome

- Landed the downloaded security patch intent across assistant payload staging, hosted execution error redaction, Stripe metering error redaction, and the narrow Cloudflare callback/smoke error surfaces.
- Added focused tests for assistant temp staging/permissions, hosted execution error redaction, Cloudflare error redaction, and the `cloudflare-hosted-control` client.
- Mandatory audit review completed with two findings; both were fixed in the same turn.

## Verification results

- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/execution-adapters.test.ts --config vitest.config.ts --no-coverage`
- PASS: `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution.test.ts --config vitest.config.ts --no-coverage`
- PASS: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-execution-dispatch.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts`
- PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/business-outcomes.test.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts`
- PASS: `pnpm --dir packages/cloudflare-hosted-control exec vitest run test/client.test.ts --passWithNoTests --no-coverage`
- FAIL (pre-existing unrelated blocker): `pnpm typecheck`
  Workspace boundary verification failed on `packages/cli/test/canonical-write-lock.test.ts` importing a non-public `@murphai/vault-usecases` entrypoint.
- FAIL (same pre-existing unrelated blocker): `pnpm test:coverage`
  The acceptance lane stopped at the same workspace-boundary failure before reaching this patch surface.
Completed: 2026-04-08
