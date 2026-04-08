# Architecture Review Patch Landing

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Evaluate and land the downloaded `murph-architecture-review.patch` changes where they still fit the live tree, keeping the implementation scoped to the artifact intent.

## Success criteria

- The Linq webhook path writes chat bindings through the routing-store owner instead of the member-identity service wrapper.
- The hosted assistant-delivery journal path is narrowed to the single supported effect family without widening unrelated runtime surfaces.
- The matching architecture review note in `agent-docs/references/data-model-seams.md` reflects the landed seam cleanup.
- Required verification runs for the touched surfaces, with any unrelated blockers called out separately.

## Scope

- In scope:
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-08-architecture-review-patch-landing.md`
- `agent-docs/references/data-model-seams.md`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `packages/hosted-execution/src/side-effects.ts`
- `packages/assistant-runtime/src/hosted-runtime/{platform.ts,callbacks.ts}`
- `apps/cloudflare/src/{runtime-platform.ts,runner-outbound/results.ts,side-effect-journal.ts}`
- Any directly affected tests needed to keep the narrowed contract green
- Out of scope:
- Broader architecture cleanup outside the downloaded artifact
- Unrelated hosted-web, assistant-runtime, or Cloudflare refactors already in flight

## Constraints

- The worktree is already heavily dirty, so the landing must preserve unrelated edits and treat the downloaded patch as behavioral intent only.
- Keep changes limited to the concrete artifact labels and touched seams already returned by the watcher flow.
- Follow the repo completion workflow, including required verification and final audit.

## Risks and mitigations

1. Risk: live files drifted since the patch was generated.
   Mitigation: read the current tree first and port the intent manually instead of applying blindly.
2. Risk: narrowing the assistant-delivery journal contract breaks existing runtime or test callers.
   Mitigation: update all directly coupled runtime/test call sites in the same landing and run the required verification lane.
3. Risk: overlapping dirty `apps/cloudflare` work makes the patch unsafe to land unchanged.
   Mitigation: keep the scope to the exact touched files and stop if the exclusive Cloudflare refactor has conflicting adjacent edits.

## Tasks

1. Register the patch-landing lane in the coordination ledger and inspect the current touched files.
2. Port the downloaded patch intent into the live tree without widening scope.
3. Run required verification for the touched packages/apps and capture any unrelated failures separately.
4. Run the required final review audit, address findings if needed, and commit only the touched paths.

## Decisions

- Use a dedicated patch-landing plan because the change touches runtime, app, and doc files across multiple packages.
- Keep the landing artifact-scoped even if the thread prose mentions additional cleanup opportunities not present in the patch.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Targeted checks as needed for directly affected tests/files
- Expected outcomes:
- The narrowed hosted assistant-delivery contract compiles, its direct tests pass, and the repo-required commands either pass or fail only for unrelated pre-existing reasons.
- Actual outcomes:
- `pnpm typecheck` passed.
- `pnpm test:coverage` failed for unrelated pre-existing repo blockers in `packages/assistantd/src/http.ts` and `packages/assistantd/src/http-protocol.ts`.
- During that same repo lane, `packages/assistant-runtime test:coverage` passed before the unrelated `assistantd` failure stopped the run.
- `pnpm --dir packages/hosted-execution test:coverage` passed after adding focused coverage for the new assistant-delivery helper aliases.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-callbacks.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/crypto.test.ts apps/cloudflare/test/side-effect-journal.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/node-runner.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare verify` failed for unrelated pre-existing tests in `apps/cloudflare/test/node-runner-isolated.test.ts` and `apps/cloudflare/test/container-image-contract.test.ts`.
Completed: 2026-04-08
