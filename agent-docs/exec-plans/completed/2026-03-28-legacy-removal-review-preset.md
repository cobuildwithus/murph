# Legacy removal review preset

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

- Add a dedicated `review:gpt` preset for greenfield hard-cut legacy-removal audits.

## Success criteria

- `scripts/review-gpt.config.sh` registers a discoverable preset for legacy-removal reviews.
- The preset prompt tells GPT to assume a hard cutover with no live deployments or state-compatibility obligations unless the current architecture still needs a path.
- Repo docs mention the preset where `review:gpt` usage already lives.
- Direct dry-run proof shows the preset resolves through the existing wrapper.

## Scope

- `scripts/review-gpt.config.sh`
- `scripts/chatgpt-review-presets/legacy-removal.md`
- `README.md`
- `agent-docs/exec-plans/{active/COORDINATION_LEDGER.md,completed/2026-03-28-legacy-removal-review-preset.md}`

## Constraints

- Keep this in the existing lightweight `review:gpt` preset family alongside `security`, `simplify`, and `bad-code`.
- Do not change completion-workflow audit prompts or widen into unrelated review tooling.
- Avoid exposing any local account or home-directory identifiers in docs or generated text.

## Verification

- `pnpm review:gpt --preset legacy-removal --dry-run`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Added the `legacy-removal` preset plus aliases for greenfield hard-cut legacy cleanup reviews.
- Documented the preset family in `README.md`.
- `pnpm review:gpt --preset legacy-removal --dry-run` passed.
- `pnpm typecheck` failed in pre-existing `packages/contracts/scripts/verify.ts` import/type errors unrelated to this preset change.
- `pnpm test` failed in pre-existing `packages/cli` build errors related to unresolved `@murph/core` imports.
- `pnpm test:coverage` failed in pre-existing `apps/web/test/hosted-execution-outbox.test.ts` type errors (`activated` missing from `HostedExecutionUserStatus`).
Completed: 2026-03-28
