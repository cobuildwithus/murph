## Goal

Add a native top-level delayed review command to `../review-gpt`, then update Murph to use that upstream command and delete the local `scripts/review-gpt-delay.sh` wrapper.

## Scope

- `../review-gpt/src/**`
- `../review-gpt/test/**`
- `../review-gpt/README.md`
- `package.json`
- `README.md`
- `scripts/review-gpt.sh`
- `scripts/review-gpt-data.sh`
- `scripts/review-gpt-diagnostics.mjs`
- `scripts/review-gpt-cli.sh`
- `scripts/review-gpt-delay.sh`

## Constraints

- Keep the upstream CLI help text and README aligned with the new command.
- Preserve Murph's existing delayed review behavior closely enough that current `review:gpt:delay` and `review:gpt:schedule` usage still works after the switch.
- Do not reintroduce prompt-only review paths; delayed sends must continue to use the attached-file review flow.

## Verification

- `../review-gpt`: `pnpm typecheck`, `pnpm test`
- `murph`: `pnpm typecheck` (still blocked by unrelated existing workspace-boundary/typecheck failures in `apps/web`, `apps/cloudflare`, and `packages/parsers`)
- `murph`: `pnpm test:repo-tools`
- `murph`: `bash -n scripts/review-gpt-cli.sh scripts/review-gpt.sh scripts/review-gpt-data.sh`
- `murph`: `node --check scripts/review-gpt-diagnostics.mjs`
- `murph`: `pnpm review:gpt:delay --help`
- `murph`: `pnpm chatgpt:thread:wake --help`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
