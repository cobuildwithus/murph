# Assistant local transcripts

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Persist assistant chat transcripts locally and replay them when a session is resumed.

## Success criteria

- Assistant prompts and replies are stored locally outside the canonical vault for each session.
- Resuming `healthybob chat --session ...` seeds the Ink UI with prior locally stored messages.
- Session list/show output stays metadata-focused rather than embedding the full transcript payload.
- Existing session metadata files remain readable, and legacy excerpt fields migrate safely into the new local transcript storage when encountered.
- Assistant docs and command descriptions stop claiming that prompt/response excerpts are never persisted locally.
- Focused assistant tests pass and required repo checks are attempted with outcomes recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/{assistant-cli-contracts.ts,commands/assistant.ts}`
- `packages/cli/src/assistant/{service,store}.ts`
- `packages/cli/src/assistant/ui/{ink,view-model}.ts`
- focused assistant coverage in `packages/cli/test/{assistant-runtime,assistant-state,assistant-cli}.test.ts`
- docs describing assistant-state persistence in `README.md`, `packages/cli/README.md`, `ARCHITECTURE.md`, and `agent-docs/operations/verification-and-runtime.md`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- provider-side transcript fetching
- canonical vault writes for assistant chat content
- unrelated assistant UI/theme/status changes already in flight

## Constraints

- Preserve overlapping assistant-lane edits already present in the worktree.
- Keep local transcript storage outside the canonical vault.
- Do not break metadata-only session list/show semantics unless explicitly chosen and documented.
- Do not revert unrelated dirty worktree state.

## Risks and mitigations

1. Risk: transcript persistence could accidentally bloat or reshape session metadata payloads.
   Mitigation: store transcript entries in a separate local transcript file per session and keep session JSON unchanged aside from existing metadata fields.
2. Risk: overlapping assistant Ink/store work could conflict in active files.
   Mitigation: keep the change narrow, read current file state before each edit, and avoid reverting adjacent changes.
3. Risk: older assistant-state files with excerpt fields could lose data.
   Mitigation: migrate any legacy excerpt fields into the new local transcript store on read before rewriting the session JSON.

## Tasks

1. Add a local transcript data shape and file path under `assistant-state`.
2. Persist user/assistant chat turns locally from the shared assistant message path.
3. Seed the Ink UI from the stored local transcript on resume.
4. Update focused tests for transcript persistence, replay, and legacy migration.
5. Update docs and command descriptions to reflect local transcript storage.
6. Run required checks, record unrelated repo failures if they remain, and commit only the scoped files.

## Decisions

- Local transcripts will live beside session metadata under `assistant-state/` rather than inside session JSON.
- Transcript replay should restore only chat entries (`user`, `assistant`, `error`) into the Ink UI, not status-line ephemera.
- Metadata-oriented assistant session commands stay transcript-free by default.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests pass
- repo-wide checks may still surface unrelated existing failures outside the touched assistant transcript files
Completed: 2026-03-17
