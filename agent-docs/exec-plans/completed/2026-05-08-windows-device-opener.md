# Windows device auth URL opener

Status: completed
Created: 2026-05-08
Updated: 2026-05-08

## Goal

- Remove the Windows shell hop from the device-sync OAuth browser opener so authorization URLs are launched through a direct browser/file-protocol handler instead of `cmd.exe`.

## Success criteria

- Windows URL opening no longer uses `cmd /c start` or bare `PATH` lookup for the opener executable.
- A focused test proves the Windows opener resolves a metacharacter-bearing `http(s)` URL to a non-`cmd.exe` direct handler command.
- Existing device-sync client behavior remains unchanged on macOS/Linux and for injected `openBrowser` test seams.

## Scope

- In scope:
  - `packages/operator-config/src/device-sync-client.ts`
  - `packages/operator-config/src/device-sync-browser-opener.ts`
  - focused operator-config test coverage in `packages/operator-config/test/http-linq-device-runtime.test.ts`
- Out of scope:
  - Health Commons URL hardening
  - stale `.deepsec` findings already fixed or removed
  - provider OAuth URL generation

## Constraints

- Technical constraints:
  - No new dependencies.
  - Keep browser-opening command selection internal to operator-config.
  - Keep URL validation at the existing owner boundary.
- Product/process constraints:
  - Preserve unrelated dirty working-tree edits and active execution-plan rows.
  - Do not expose local paths, usernames, secrets, or personal identifiers in files or output.

## Risks and mitigations

1. Risk: Windows launcher behavior changes.
   Mitigation: Use the platform file-protocol handler directly through a constrained system path and cover the command/argument shape in a unit test.

## Tasks

1. Inspect current opener and nearby tests.
2. Replace the Windows `cmd` launcher with a non-shell launcher.
3. Add focused regression coverage for shell metacharacters.
4. Run scoped verification and required completion audits.
5. Commit scoped changes if the dirty worktree allows it.

## Decisions

- Fix only the active Windows opener issue from the `.deepsec` high findings; do not add broader URL hardening in this task.
- Keep the launcher resolver in an internal source module rather than exporting it through the package index.

## Verification

- Commands to run:
  - `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts`
  - `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/device-sync-client.ts packages/operator-config/test/http-linq-device-runtime.test.ts`
  - `pnpm typecheck`
- Expected outcomes:
  - focused tests pass
  - diff-aware verification covers operator-config and reverse dependents
  - typecheck passes or any unrelated blocker is reported precisely

## Verification Results

- `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts` passed.
- `pnpm typecheck` passed.
- `git diff --check` for this task's files passed.
- `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/device-sync-client.ts packages/operator-config/test/http-linq-device-runtime.test.ts` reached reverse-dependent CLI tests and failed in existing CLI test targets unrelated to the opener path:
  - `packages/cli/test/search-runtime.test.ts` timed out in `timeline merges journals, events, and sample summaries into one descending feed`.
  - `packages/cli/test/device-daemon.test.ts` failed `stopManagedDeviceSyncDaemon stops the managed process and removes launcher state`.
- `pnpm --dir packages/operator-config test:coverage` failed in existing `packages/operator-config/test/device-daemon-runtime.test.ts` targets unrelated to the opener path.
- `security-privacy-review` initially found bare Windows executable lookup and public helper-surface issues; both were fixed. Follow-up review found no remaining security/privacy issues.
- `coverage-write` reviewed the updated test coverage and made no edits; it found the focused Windows opener coverage sufficient.
Completed: 2026-05-08
