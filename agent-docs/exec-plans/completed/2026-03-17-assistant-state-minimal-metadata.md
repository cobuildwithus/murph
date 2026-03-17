# Assistant state minimal metadata

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Stop persisting assistant prompt/response excerpts under `assistant-state/` by default so local session files contain only minimal metadata and provider session references.

## Success criteria

- New or updated assistant session files no longer include persisted prompt/response excerpt fields by default.
- Existing legacy session files transparently migrate to the metadata-only shape when read or rewritten.
- `assistant session list|show` no longer surface stored transcript excerpts.
- The Ink chat UI does not seed conversation history from persisted assistant-state excerpts.
- Docs and tests explicitly describe and verify the metadata-only storage rule.

## Scope

- In scope:
- assistant session contracts, persistence, migration, and runtime writers
- assistant session CLI read surfaces
- Ink chat transcript seeding behavior
- aligned docs and focused assistant tests
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- upstream provider transcript retention policies
- new opt-in encrypted transcript storage
- non-assistant vault/runtime state

## Constraints

- Preserve existing session binding semantics, alias/conversation-key indexes, timestamps, turn counts, and `providerSessionId`.
- Treat stored prompt/response excerpts as sensitive and remove them from default persisted/session-returned state rather than renaming them.
- Preserve adjacent in-progress Ink UI changes in the same files.
- Keep migration behavior deterministic and local to assistant-state reads/writes.

## Risks and mitigations

1. Risk: older session files could fail validation once the schema drops excerpt fields.
   Mitigation: accept legacy shapes on read, normalize them into the new schema, and rewrite metadata-only session JSON.
2. Risk: CLI/UI tests may implicitly depend on seeded transcript excerpts.
   Mitigation: update focused tests to assert metadata-only storage and empty seeded history by default.
3. Risk: docs could drift from runtime behavior again.
   Mitigation: update the architecture, README, and runtime-verification docs in the same change.

## Tasks

1. Remove default persisted transcript excerpt fields from assistant session contracts and write paths.
2. Add legacy session migration that strips old excerpt fields while preserving minimal metadata.
3. Update session list/show and Ink transcript seeding expectations to match metadata-only state.
4. Refresh docs and focused assistant tests, then run the required audit and verification commands.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-channel.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Completed: 2026-03-17
