# Assistant Markdown memory

Status: completed
Created: 2026-03-17
Updated: 2026-03-28

## Goal

- Add a simple vault-scoped assistant memory system that mirrors a Markdown-first workflow while staying local-first and out of the canonical vault.
- Persist distilled conversational memory under `assistant-state/` and automatically load it into fresh assistant sessions.
- Allow selected durable health context to be remembered for future conversations when it is clearly useful, while keeping the canonical vault authoritative on conflicts.

## Success criteria

- Assistant memory lives outside the canonical vault under the vault-scoped `assistant-state/` bucket as Markdown files.
- New assistant sessions automatically load long-term memory plus recent daily notes into the provider bootstrap prompt.
- Successful assistant turns can update those Markdown docs automatically from conservative identity/preference/instruction/project-context cues plus selected durable health context.
- Automatic memory writes still avoid raw prompt/response excerpts in the Markdown memory files and do not make assistant memory canonical health truth.
- Focused tests and docs cover the new behavior and updated trust boundaries.

## Scope

- In scope:
  - assistant memory path resolution, Markdown read/write helpers, prompt injection, and conservative automatic memory extraction
  - selected health-context persistence in out-of-vault assistant memory for future conversational continuity
  - focused assistant runtime/service/state tests
  - architecture/runtime/README docs that describe the new out-of-vault memory behavior
- Out of scope:
  - vector or semantic memory search
  - canonical vault writes derived from assistant chat memory
  - encrypted transcript storage or full chat-log persistence
  - new public CLI commands unless a tiny read-only helper becomes necessary

## Constraints

- Keep memory files outside the canonical vault under `assistant-state/`.
- Keep Markdown as the editable source of truth; do not add SQLite or vector storage for this feature.
- Do not persist raw prompt/response excerpts in the Markdown memory files.
- Treat assistant memory as conversational continuity only; if it conflicts with the vault, trust the vault.
- Preserve existing assistant session alias/binding semantics and provider-backed session reuse.

## Risks and mitigations

1. Risk: automatic health-memory extraction captures facts that should remain canonical-only.
   Mitigation: keep extraction narrow, bias toward durable future-useful context, and document that the vault remains authoritative.
2. Risk: prompt bloat from unbounded Markdown memory.
   Mitigation: keep the file format small and human-curated, cap injected excerpts, and only load long-term memory plus recent daily notes.
3. Risk: stale or conflicting memory notes.
   Mitigation: append dated bullets, make newer bullets override older ones, and keep files manually editable.

## Tasks

1. Add assistant memory path helpers plus Markdown load/write utilities under the assistant runtime.
2. Inject assistant memory into bootstrap prompts for fresh sessions or sessions without a reusable provider session.
3. Add conservative automatic memory extraction and merge logic for durable preferences/instructions, short-lived project context, and selected health context.
4. Update focused tests and runtime/architecture docs.
5. Run targeted tests plus repo-required verification commands, then record outcomes in handoff.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Outcome

- Added vault-scoped assistant Markdown memory under `assistant-state/<vault-bucket>/MEMORY.md` plus `assistant-state/<vault-bucket>/memory/YYYY-MM-DD.md`.
- New assistant sessions now bootstrap from long-term memory plus recent daily notes when a fresh provider session starts.
- Successful assistant turns now distill naming, response preferences, standing instructions, project context, and selected health context into those Markdown docs.
- Assistant memory stays non-canonical; the vault remains authoritative when memory and canonical records disagree.

## Verification results

- Focused assistant verification passed:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck` failed in an unrelated pre-existing CLI helper path:
  - `packages/cli/src/usecases/vault-usecase-helpers.ts`
- `pnpm test` failed in unrelated pre-existing inbox help smoke assertions:
  - `packages/cli/test/inbox-incur-smoke.test.ts`
- `pnpm test:coverage` failed in unrelated pre-existing CLI smoke assertions plus a downstream Vitest coverage-artifact error after those test failures:
  - `packages/cli/test/inbox-incur-smoke.test.ts`
  - `packages/cli/test/incur-smoke.test.ts`
Completed: 2026-03-28
