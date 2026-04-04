# Bump review-gpt to 0.5.31 and use the new wake resume prompt

Status: completed
Created: 2026-04-04
Updated: 2026-04-04

## Goal

- Update Murph to the published `@cobuild/review-gpt@0.5.31` release so `thread wake` can append custom follow-up instructions to the spawned Codex child prompt.
- Use the new `--resume-prompt` flag for the user's requested Pro-thread workflow once the published package is installed locally.

## Success criteria

- Root `package.json` and `pnpm-lock.yaml` resolve `@cobuild/review-gpt` to the published `0.5.31` release.
- The installed `cobuild-review-gpt thread wake` help exposes the new `--resume-prompt` option.
- The requested watch command is launched from Murph with the user's supplied follow-up instructions.
- Required Murph verification passes, or any unrelated blocker is documented concretely.

## Scope

- In scope:
  - Murph root dependency metadata and lockfile updates for `@cobuild/review-gpt`.
  - Minimal active-plan and coordination-ledger bookkeeping for this rollout.
  - Direct local proof that the new wake flag is available and used with the requested constraints.
- Out of scope:
  - Editing unrelated active Murph worktree changes.
  - Reworking Murph's wrapper scripts unless the new published CLI cannot be reached through the existing dependency wiring.
  - Nudging or rewriting the upstream ChatGPT threads.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty-tree edits already present in Murph.
  - Keep the downstream diff scoped to the dependency rollout and required bookkeeping.
  - Use the published npm package rather than a Murph-local patch or file dependency.
- Product/process constraints:
  - Run Murph's required verification after the dependency bump.
  - Record the exact wake command used for the user's requested flow.

## Risks and mitigations

1. Risk: npm publish visibility lags behind the pushed `review-gpt` tag, leading to a partial or stale install.
   Mitigation: Poll the registry until `@cobuild/review-gpt@0.5.31` is visible before updating Murph.
2. Risk: the dependency bump collides with unrelated dirty-tree work in Murph.
   Mitigation: Limit edits to the dependency files plus plan/ledger bookkeeping and use scoped commit helpers.
3. Risk: the new CLI flag is present upstream but not reachable through Murph's installed binary.
   Mitigation: Verify the installed `thread wake` help locally before launching the requested watch command.

## Tasks

1. Wait for `@cobuild/review-gpt@0.5.31` to become visible on npm.
2. Update Murph's dependency and lockfile to the published version without widening the diff.
3. Verify the installed CLI exposes `--resume-prompt` and run the requested watch command with the supplied follow-up instructions.
4. Run Murph verification and finish the scoped commit and plan closure flow.

## Decisions

- Treat the change as an upstream-tool rollout, not a Murph-local wrapper patch.
- Keep the downstream rollout manual instead of using the upstream repo's auto-sync because Murph already has unrelated in-flight edits.

## Verification

- Commands to run:
  - `npm view @cobuild/review-gpt version`
  - `pnpm up -D @cobuild/review-gpt@^0.5.31`
  - `pnpm exec cobuild-review-gpt thread wake --help`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - npm reports `0.5.31`, the local CLI exposes `--resume-prompt`, and Murph verification completes or any unrelated blocker is explicit.

## Current state

- `npm view @cobuild/review-gpt version` returned `0.5.31`.
- `pnpm deps:guard`, `pnpm deps:ignored-builds`, `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all passed after the downstream bump.
- `pnpm exec cobuild-review-gpt thread wake --help` now shows `--resume-prompt <string>`.
- Live watcher launched from Murph:
  - Command: `pnpm exec cobuild-review-gpt thread wake --delay 0s --poll-interval 1m --chat-url https://chatgpt.com/c/69d050da-1f78-839a-b8dc-f15a9b2c5d04 --session-id "$CODEX_THREAD_ID" --resume-prompt "After you apply any returned patch and run the repo-required verification, send a final review request with pnpm review:gpt --send --chat-url https://chatgpt.com/c/69d0b8a4-6918-839c-bf1d-a9651ad2979c --preset simplify --prompt 'Review the just-completed local changes for final bugs, regressions, and behavior-preserving simplification opportunities. Focus on the current changes only and keep findings concrete.' before your final wrap-up."`
  - Output directory: `output-packages/chatgpt-watch/69d050da-1f78-839a-b8dc-f15a9b2c5d04-2026-04-04T082645Z`
  - Poll status observed locally: two checks completed, thread still busy, two attachments visible, polling continues every minute.
Completed: 2026-04-04
