# Auto Reply Simplify

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Reduce duplication in the just-landed assistant auto-reply multimodal path without changing behavior: keep one prepared-input prompt path, centralize rich-route selection, and trim repeated runtime test setup.

## Success criteria

- Auto-reply prompt preparation no longer maintains parallel legacy and prepared rendering paths for the same capture bundle flow.
- Rich-content auto-reply route selection is shared through a smaller helper instead of being rebuilt inline in the reply decision path.
- The photo-only auto-reply runtime tests share setup helpers instead of repeating the same temp-dir, defaults, attachment, and inbox-service scaffolding.
- Focused assistant build/typecheck/tests pass, plus required repo verification commands are run or any unrelated pre-existing failures are documented.

## Scope

- In scope:
- `packages/assistant-core/src/assistant/automation/{prompt-builder.ts,reply.ts}`
- `packages/assistant-core/src/inbox-multimodal.ts` only if needed to support the narrower refactor cleanly
- Focused runtime/provider tests under `packages/cli/test/{assistant-provider.test.ts,assistant-runtime.test.ts}`
- Out of scope:
- New product behavior, provider capability semantics, or broader provider-helper normalization
- Changes outside the assistant auto-reply multimodal cleanup lane unless required to keep tests green

## Constraints

- Technical constraints:
- Preserve the existing multimodal auto-reply behavior that was just landed, including rich-only reroute behavior and text-only provider skips.
- Keep ownership boundaries intact: shared runtime logic stays in assistant-core and tests stay focused.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Use the coordination ledger, required verification, required audit subagent pass, and a scoped commit path.

## Risks and mitigations

1. Risk: collapsing prompt-builder paths could accidentally change the text-only prompt that existing tests rely on.
   Mitigation: keep prompt rendering behavior covered by the existing prompt-builder tests and rerun focused auto-reply runtime coverage.
2. Risk: route-selection cleanup could subtly break failover precedence.
   Mitigation: preserve the current provider/default/failover ordering and keep the rich-failover runtime test as a guardrail.

## Tasks

1. Replace duplicate prompt-builder rendering with a single prepared-input path.
2. Extract shared rich-route selection helpers from the auto-reply decision path.
3. Introduce shared runtime-test helpers for photo-only auto-reply setup and update the focused tests.
4. Run focused verification, required audit review, and commit the exact touched files.

## Decisions

- Start with the local simplification targets already identified in the landed diff rather than expanding into adjacent provider-helper cleanup.

## Verification

- Commands to run:
- `git diff --check`
- `pnpm --filter @murphai/assistant-core build`
- `pnpm exec tsc -p packages/assistant-core/tsconfig.json --pretty false --noEmit`
- `pnpm exec vitest --run --coverage.enabled false packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts`
- `pnpm test:smoke`
- `pnpm typecheck`
- `pnpm test:packages`
- Expected outcomes:
- Focused assistant build/typecheck/tests and smoke pass.
- If repo-wide commands still fail outside this refactor, capture the unrelated failing surface before handoff and still commit the scoped change.
Completed: 2026-04-02
