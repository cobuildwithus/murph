# DeepSec Terminal Output Hardening

## Goal

Close the best low-complexity remaining DeepSec terminal-output finding by ensuring untrusted assistant/provider text cannot preserve terminal control sequences in the assistant CLI UI.

Success criteria:

- Provider progress events, streamed assistant/status/error/thinking updates, transcript seeds, and rendered plain text strip ANSI escape, OSC, C1, and other control characters before reaching Ink text output.
- New behavior is covered by focused assistant CLI UI tests.
- Existing wrapping and stream append behavior remains deterministic.

## Constraints

- Keep the fix local to `packages/assistant-cli`.
- Preserve unrelated dirty edits, including existing assistant-engine redaction work already present in the working tree.
- Do not add dependencies or broad rendering abstractions.
- Do not expose secrets, local paths, or personal identifiers in docs/tests/output.

## Plan

1. Inspect assistant CLI UI text normalization and tests.
2. Add a small shared terminal-text sanitizer inside the existing UI helper surface.
3. Apply it where untrusted assistant/provider/transcript text enters the UI model or plain-text renderer.
4. Add focused regression tests for OSC/ANSI/control stripping.
5. Run scoped assistant CLI verification and required completion audits.
6. Close the plan with a scoped commit if the worktree allows it.

## Verification

- `pnpm --dir packages/assistant-cli test -- --runInBand assistant-ui-helpers.test.ts assistant-ui-rendering.test.ts` passed; the package script ran all 21 assistant-cli test files / 121 tests.
- `pnpm --dir packages/assistant-cli typecheck` passed.
- `pnpm --dir packages/assistant-cli test:coverage` passed after audit-driven fixes; 21 files / 121 tests, coverage summary: statements 94.18%, branches 86.22%, functions 97%, lines 94.09%.
- Scoped `git diff --check` passed for the plan, assistant CLI UI files, and focused tests.
- Root `pnpm typecheck` was attempted but stopped after waiting on an unrelated active Cloudflare runner-bundle workspace lock.
- Required `coverage-write`, `security-privacy-review`, and `task-finish-review` subagent passes completed. Security review found and re-checked the markdown-link sink fix. Final review found and re-checked the live error/status/user row sink fix.

## Handoff Notes

- Kept the implementation local to assistant CLI UI rendering helpers and tests.
- Existing assistant-engine redaction edits were already present in the working tree and were preserved as unrelated work.
- Remaining residual proof gap: no full failed-turn E2E path was added, but the final reviewer accepted the render-sink component test as the right boundary for this narrow fix.

Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
