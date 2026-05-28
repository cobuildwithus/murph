# Context Compaction Copy Rotation

## Goal

Rotate the current-channel context-compaction progress copy across a small set of short, casual messages while preserving the existing `AssistantTurnProgress` delivery path.

Success criteria:

- Keep the message metadata-only and fixed to the approved short strings.
- Pick randomly from the fixed array; tests stub `Math.random` so no runtime state is added.
- Preserve the current behavior that compaction progress is not emitted through provider progress/trace callbacks.
- Filter compaction raw events out of the trace callback so current-channel progress remains the only compaction delivery surface.
- Keep the extraction helper name explicit that it feeds current-channel progress, not all provider progress surfaces.
- Remove unreachable completed-compaction copy from the current-channel helper.
- Cover deterministic selection and the runtime send path with focused tests.

## Constraints

- Do not add storage, a new delivery path, or model-visible messages.
- Do not expose prompts, transcripts, channel identifiers, provider payloads, local paths, or secrets.
- Preserve unrelated active ledger and working-tree edits.

## Plan

1. Add the approved compaction progress text array and random selector.
2. Use the selector from the existing compaction turn-progress extraction helper.
3. Rename the helper for current-channel intent and remove unreachable completed-copy logic. Done.
4. Correct the prior completed-plan note that overstated trace/completed-progress coverage. Done.
5. Update focused runtime tests. Done.
6. Filter compaction raw events out of `onTraceEvent`. Done.
7. Run focused verification and required completion audits. In progress.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts -t "compacts context"` passed.
- `git diff --check -- packages/assistant-engine/src/assistant-codex-events.ts packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts agent-docs/exec-plans/active/2026-05-28-context-compaction-copy-rotation.md agent-docs/exec-plans/completed/2026-05-28-context-compaction-progress.md` passed.
- `pnpm typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.

## Audits

- `security-privacy-review`: first pass found low trace raw-event exposure for compaction; fixed by filtering compaction status items out of `onTraceEvent` and adding a raw-event regression assertion.
- `security-privacy-review` rerun: no findings.
- `coverage-write`: no changes; current runtime test covers randomized fixed copy, one current-channel send, no provider progress, no trace update, no trace raw event, and no completed-copy path.
- `task-finish-review`: no findings. Residual gap: no live hosted chat/channel path exercised.
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
