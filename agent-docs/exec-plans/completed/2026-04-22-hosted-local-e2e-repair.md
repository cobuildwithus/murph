# Repair hosted local full-stack e2e failures

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Restore the hosted local full-stack e2e lane so the focused Telegram and Linq flows, plus the composed `test:e2e:local` command, complete cleanly in the current checkout, while improving local debugging/observability where the investigation proved it was needed.

## Success criteria

- `pnpm --dir apps/cloudflare test:e2e:local` passes in this checkout.
- Any focused hosted local e2e command used during debugging also passes after the fix.
- The repair stays scoped to the hosted local e2e harness, directly coupled helpers/specs, and the runtime/store notification seams the failing lane exercised.

## Scope

- In scope:
- `apps/cloudflare/test/hosted-local-*.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-*.ts`
- `apps/cloudflare/scripts/run-hosted-local-e2e.ts`
- directly coupled `packages/assistant-engine/**`, `packages/assistant-runtime/**`, and `apps/web/src/lib/hosted-run/**` only where the failing hosted-local lane proved the defect or missing observability lived there
- directly coupled `scripts/dev-hosted-local/**` helpers only if the root cause lives there
- Out of scope:
- unrelated hosted onboarding, billing, Health Commons, or general app verify fallout
- production behavior changes outside what the hosted local e2e harness strictly needs

## Constraints

- Technical constraints:
- Preserve existing hosted execution and auth invariants; fix the harness or expectations instead of weakening production contracts.
- Avoid widening into unrelated `apps/web`, `packages/assistant-runtime`, or `packages/assistant-engine` rows already active in this checkout unless the failing e2e lane proves the defect or required observability gap lives there.
- Product/process constraints:
- Keep the diff proportional to making the existing local hosted e2e lane reliable again.
- Follow the repo completion workflow, including the required coverage/final-review audit passes for repo code changes.

## Risks and mitigations

1. Risk: The failure is caused by overlapping dirty-tree work rather than the harness itself.
   Mitigation: Reproduce from the current checkout first, isolate the first deterministic failure, and keep the fix on the minimum owned files.
2. Risk: A harness-only workaround could mask a real hosted runtime regression.
   Mitigation: Prefer fixes that preserve the end-to-end assertions and rerun the full local suite after any targeted debugging pass.

## Tasks

1. Reproduce the failing `apps/cloudflare` local full-stack e2e lane and capture the first deterministic failure.
2. Trace the failure through the hosted local harness and directly coupled helpers/specs.
3. Implement the smallest fix that restores the full local suite.
4. Rerun targeted checks and the full hosted local e2e lane.
5. Complete required audits, rerun affected checks after audit fixes, and finish the task with a scoped commit.

## Decisions

- Verification must include the full `pnpm --dir apps/cloudflare test:e2e:local` lane, not only the focused CI subsets.
- The hosted-local assistant provider stub must match the OpenAI Responses API shape the current AI SDK path actually consumes, including `annotations` and `usage`.
- Keep added debugging opt-in and local-only where possible so the lane gets better observability without broadening production behavior.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test:e2e:local`
- truthful targeted debugging reruns for any failing hosted-local e2e file
- scoped tests for touched helpers/runtime/store seams
- typecheck the touched workspaces
- Expected outcomes:
- the hosted local full-stack e2e suite passes end to end
- targeted debugging reruns stay green after the final fix
- touched workspace typechecks finish cleanly

## Outcome

- Fixed the hosted-local assistant provider stub so local notification turns can use `POST /v1/responses` with the response fields the AI SDK requires.
- Switched local hosted e2e scripts to `runner:bundle:hosted-local` so the advertised local commands exercise the correct bundle path.
- Added local-only observability to the hosted notification/runtime and harness failure messages so future investigations surface provider and Linq request context directly.
- Tightened hosted-run acquisition so empty work is not synthesized unless `manual_repair` was explicitly requested, while preserving explicit manual repair runs.

## Verification Results

- `pnpm --dir apps/cloudflare test:e2e:local`
  Passed. The composed hosted-local lane finished with three green files (`4 + 3 + 3` tests) on the real package script path after rebuilding the hosted-local runner bundle.
- `pnpm exec vitest run packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts packages/assistant-engine/test/provider-turn-runner.test.ts --no-coverage`
  Passed.
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-events.test.ts --no-coverage`
  Passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-local-e2e-support.test.ts apps/cloudflare/test/container-image-contract.test.ts --no-coverage`
  Passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-run-store.test.ts --no-coverage`
  Passed.
- `pnpm --dir packages/assistant-engine typecheck`
  Passed.
- `pnpm --dir packages/assistant-runtime typecheck`
  Passed.
- `pnpm --dir apps/cloudflare typecheck`
  Passed.
- `pnpm --dir apps/web typecheck`
  Passed.
Completed: 2026-04-22
