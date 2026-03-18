# Assistant chat dark mode

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Make the Ink-backed Healthy Bob chat automatically pick a light or dark palette so the composer and user-turn blocks do not clash with the surrounding terminal.

## Success criteria

- The assistant chat resolves a dark palette automatically when the system/terminal indicates dark appearance.
- The composer, user-message blocks, model picker, slash suggestions, and status accents all use the resolved palette instead of hard-coded light colors.
- Focused theme-detection tests pass and required repo checks are attempted with outcomes recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/src/assistant/ui/theme.ts`
- focused theme coverage in `packages/cli/test/assistant-chat-theme.test.ts`
- `vitest.config.ts`
- `agent-docs/index.md`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- broader assistant runtime/provider behavior
- non-color layout changes
- user-configurable theme overrides unless a tiny supporting hook became unavoidable

## Constraints

- Preserve overlapping active assistant Ink UI edits already in flight.
- Keep the change local to palette resolution and color plumbing.
- Do not revert unrelated dirty worktree state.

## Risks and mitigations

1. Risk: system-theme detection may be unavailable or inaccurate in some terminals.
   Mitigation: use a deterministic, best-effort resolver with documented precedence and a safe light fallback.
2. Risk: dark-mode colors could reduce readability for statuses or picker rows.
   Mitigation: route all UI colors through one palette object so contrast tuning stays consistent.
3. Risk: repo-wide unrelated failures could obscure this UI-only slice.
   Mitigation: run focused tests plus required repo checks and record unrelated failures separately.

## Tasks

1. Add a best-effort assistant chat theme resolver and palette definitions.
2. Rewire the Ink chat UI to use the resolved palette for composer, user rows, picker, and status colors.
3. Add focused tests for theme detection precedence and fallback behavior.
4. Run required checks, then the completion-workflow audit passes, and hand off exact outcomes.

## Decisions

- Prefer actual terminal/background signals when available, but use macOS system appearance as the requested best-effort fallback for local Healthy Bob usage.
- Keep the theme resolver separate from `ink.ts` so it can be tested without rendering Ink.
- Register the focused theme test in the root Vitest allowlist because this repo uses an explicit include list instead of a glob.

## Verification

- Commands run:
- `pnpm exec vitest run packages/cli/test/assistant-chat-theme.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli typecheck`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Results

- `pnpm exec vitest run packages/cli/test/assistant-chat-theme.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`: passed (`2` files, `23` tests)
- `pnpm --dir packages/cli typecheck`: passed
- `pnpm typecheck`: passed
- `pnpm test`: failed outside this lane in existing CLI worktree changes:
  `packages/cli/test/inbox-incur-smoke.test.ts` still expects older inbox help text,
  `packages/cli/test/setup-cli.test.ts` hits a pre-existing `@healthybob/contracts/dist/index.js` module-resolution failure from source-path imports,
  and `packages/cli/test/health-tail.test.ts` hits broader active CLI descriptor/type errors while building the CLI
- `pnpm test:coverage`: failed outside this lane after the same pre-existing CLI test failures, then aborted coverage merge with a missing `coverage/.tmp/coverage-2.json` artifact

## Audit notes

- Simplify pass: no further behavior-preserving simplification was worth applying beyond centralizing the palette in `theme.ts` and consuming it through one React context in `ink.ts`.
- Test-coverage audit: the highest-value new coverage was theme-resolution precedence and palette selection; added `packages/cli/test/assistant-chat-theme.test.ts` and registered it in the root Vitest allowlist.
- Final review: no dark-mode regressions found in the touched chat UI path; residual risk is limited to terminals that do not expose `COLORFGBG` and do not match macOS system appearance, in which case the resolver intentionally falls back to the light palette.

Completed: 2026-03-17
