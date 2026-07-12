# PR 557 final audit fixes

## Goal

Make a completed ReviewGPT audit terminal and durable without allowing ordinary task text, optional evidence, or bounded target-cleanup uncertainty to trigger a duplicate model run.

## Constraints

- Preserve exact committed-turn and per-run nonce binding.
- Keep `MODEL_CONFIRMATION: UNKNOWN` accepted only with matching platform metadata or at least ten minutes of observed generation; any present contradictory slug still fails.
- The response file is mandatory when configured; model evidence remains optional and must never convert a completed response into a retry.
- Target cleanup stays exact-owner and bounded. Pre-completion cleanup failures remain fatal; post-completion cleanup uncertainty becomes a diagnostic, not a model failure.
- Do not launch another ReviewGPT audit for this head.

## Plan

1. Make confirmation prompt insertion depend on a package-owned exact sentinel rather than task-body substrings, with an end-to-end collision regression.
2. Commit mandatory response artifacts before publishing completion; degrade optional evidence-write failures to explicit warnings without verification claims.
3. Preserve a valid completed capture across bounded post-completion target-cleanup uncertainty while retaining exact-target cleanup attempts.
4. Regenerate the dependency patch and lock hash, then run focused tests, CLI typecheck, frozen install, syntax, diff, and privacy checks.

## State

Implementation and verification complete; ready for the scoped finish-task commit.

## Verification

- `pnpm install --frozen-lockfile` (pass)
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts` (33 tests pass)
- `pnpm --filter @murphai/murph typecheck` (pass)
- `pnpm test:diff` (pass, including affected packages, web, and Cloudflare verification)
- `node --check node_modules/@cobuild/review-gpt/src/prepare-chatgpt-draft.js` (pass)
- `git diff --check` (pass)
- Lockfile inspection: only the three ReviewGPT patch-hash references changed.
- Added-line privacy inspection: no home-directory path or personal identifier added; the only email-shaped token is the scoped dependency patch filename.

Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
