## Goal

Remove `--prompt-only` from the repo-owned `review:gpt` workflow so attached-file review remains the only supported path through the local wrapper scripts.

## Scope

- `scripts/review-gpt.sh`
- `scripts/review-gpt-delay.sh`

## Constraints

- Keep the change limited to repo-owned wrapper behavior; do not try to patch the upstream `cobuild-review-gpt` package.
- Preserve unrelated worktree edits and active lanes.
- Do not edit completed execution plans; they are immutable snapshots.

## Verification

- `pnpm typecheck`
- `bash -n scripts/review-gpt.sh scripts/review-gpt-delay.sh`

## Current results

- `pnpm typecheck`: passed. The command also surfaced pre-existing unrelated workspace-boundary warnings in Cloudflare test files before continuing; the overall lane still exited successfully.
- `bash -n scripts/review-gpt.sh scripts/review-gpt-delay.sh`: passed.
- Direct behavior proof:
  - `bash scripts/review-gpt.sh --prompt-only true`: exits 1 with the expected repo-local disabled message.
  - `bash scripts/review-gpt-delay.sh --prompt-only true`: exits 1 with the expected repo-local disabled message.
- The delayed wrapper no longer auto-injects `--prompt-only true` for chat follow-ups.

Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
