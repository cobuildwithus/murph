# 2026-03-26 Assistant stop recovery

## Goal

Add a first-class operator recovery path for a stuck `healthybob run` / `assistant run` loop so the vault-scoped automation lock can be cleared without manual filesystem cleanup.

## Constraints

- Preserve the existing stale-lock auto-clear behavior when the recorded PID is already gone.
- Treat active locks as a real running process first; recovery should signal the process and wait for the lock to clear instead of deleting lock files optimistically.
- Keep the change additive and aligned with the existing assistant observability surfaces already landing in this tree.
- Preserve overlapping in-flight assistant edits in `commands/assistant.ts`, `assistant-cli-contracts.ts`, and assistant observability tests/docs.

## Planned shape

- Add a small assistant stop/recovery module that reads the run-lock metadata, sends `SIGTERM`, waits for the PID/run lock to clear, and reports whether the stop was graceful or stale.
- Add typed CLI result contracts for assistant stop so both nested and root aliases have stable schemas.
- Register `assistant stop` plus the root `stop` alias beside the existing `run|status|doctor` assistant surfaces.
- Add focused tests for live-stop, stale-stop, and root-alias schema/default-vault coverage.
- Update the command-surface and runtime docs so recovery is discoverable and verification remains truthful.

## Deliberate non-goals

- No manual lock-file deletion command.
- No broad process manager or background supervisor.
- No change to canonical vault data or assistant memory semantics.
