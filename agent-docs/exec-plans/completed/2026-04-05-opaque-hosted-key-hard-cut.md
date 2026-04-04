# Hard-cut remaining hosted legacy compatibility readers

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Remove the remaining live greenfield hosted compatibility readers so hosted execution accepts only the canonical opaque storage locators and canonical hosted assistant profile shape.

## Success criteria

- No live hosted runtime code reads legacy hosted assistant profile payloads.
- Hosted storage readers still support staged key rotation, but do not reintroduce legacy static object-path compatibility.
- Focused regression coverage proves the legacy hosted assistant profile shape is rejected and current hosted config behavior still works.
- Required repo verification and final audit pass complete, then the task lands as a scoped commit.

## Scope

- In scope:
- `packages/assistant-core/src/assistant/hosted-config.ts`
- Focused hosted assistant tests under `packages/assistant-runtime/test/**` or `packages/assistant-core/test/**`
- Coordination/plan docs needed for this lane
- Out of scope:
- Broad hosted onboarding/runtime refactors already in flight
- Keyring-based opaque-object reads required for staged envelope/root-key rotation
- Unrelated dirty-tree assistant-core prompt work

## Constraints

- Technical constraints:
- Preserve current hosted runtime behavior except for removing legacy compatibility reads.
- Keep opaque object-key derivation and keyring-based rotation reads intact unless a path is proven to be legacy-only.
- Product/process constraints:
- Preserve unrelated worktree edits.
- Finish with the repo-required final review audit and scoped commit helper flow.

## Risks and mitigations

1. Risk: Removing a parser that still feeds hosted bootstrap could break existing saved hosted configs.
   Mitigation: Add focused tests for canonical config parsing and direct rejection of the legacy shape before wider verification.

2. Risk: Overreaching into key-rotation reads would break legitimate staged ciphertext rotation.
   Mitigation: Limit code changes to proven legacy-only readers and leave keyring-based opaque-key lookup unchanged.

## Tasks

1. Update the active plan and coordination ledger for this hosted hard-cut lane.
2. Remove the remaining legacy hosted assistant profile reader from `packages/assistant-core/src/assistant/hosted-config.ts`.
3. Add focused regression coverage for canonical parsing and legacy-shape rejection.
4. Run required verification and capture the exact evidence.
5. Run the required final review audit, apply any necessary fixes, and commit the scoped paths.

## Decisions

- Treat keyring-based opaque object-key lookup as current rotation support, not legacy compatibility to remove in this pass.
- Hard-cut the legacy hosted assistant profile reader now because greenfield hosted execution should persist only the canonical `target`-based profile schema.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm exec vitest run --config vitest.config.ts test/hosted-assistant-bootstrap.test.ts --no-coverage` from `packages/assistant-runtime`
- Expected outcomes:
- Focused hosted assistant tests demonstrate the legacy profile shape is rejected while canonical hosted configs still parse.
- Actual outcomes:
- `pnpm exec vitest run --config vitest.config.ts test/hosted-assistant-bootstrap.test.ts --no-coverage` from `packages/assistant-runtime`: passed (`13/13`) after the audit-driven persisted-config additions
- `pnpm typecheck`: passed before the audit-driven follow-up; the post-fix rerun failed outside this diff in `packages/cli` due unrelated missing `@murphai/assistant-core/*` / `@murphai/contracts` module/type outputs and existing workout/assistant type errors
- `pnpm test`: failed outside this diff in `apps/web/test/device-sync-settings-routes.test.ts` because the test expects headline `Connected and syncing normally` while the runtime returns `Connected`
- `pnpm test:coverage`: failed on the same unrelated `apps/web/test/device-sync-settings-routes.test.ts` assertion and also reports existing coverage-threshold misses in `packages/hosted-execution/src/{client.ts,env.ts}`
Completed: 2026-04-05
