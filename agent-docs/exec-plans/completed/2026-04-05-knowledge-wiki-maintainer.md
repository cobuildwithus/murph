# Knowledge wiki maintainer prompt, log, and two-layer cleanup

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Make Murph's assistant runtime behave like a disciplined wiki maintainer for the existing derived knowledge surface, add the missing append-only knowledge log artifact, and make the stable `bank/library` reference graph explicitly composable with the personal `derived/knowledge` wiki.

## Success criteria

- The assistant system prompt tells Murph to use the first-class knowledge tools as the primary wiki-maintainer surface, read the knowledge index first for wiki tasks, update existing pages before creating near-duplicates, and append explicit contradiction/supersession notes rather than silently overwriting prior claims.
- Knowledge writes maintain a durable `derived/knowledge/log.md` artifact, and operators can inspect recent entries through a narrow CLI command without introducing a second orchestration surface.
- Derived knowledge pages can optionally link back to stable `bank/library` entities through validated metadata, and lint catches invalid links.
- Repo docs and command descriptions clearly explain the two-layer model: `bank/library` as the stable health reference graph and `derived/knowledge` as the user-specific compiled wiki.
- Focused tests cover the new prompt guidance, knowledge log write/read behavior, and library-link validation.

## Scope

- In scope:
- `packages/assistant-core/src/assistant/{system-prompt.ts,assistant-cli-tools.ts}`
- `packages/assistant-core/src/knowledge/**`
- `packages/query/src/{knowledge-graph.ts,health-library.ts,index.ts}`
- `packages/cli/src/commands/knowledge.ts`
- `packages/cli/src/vault-cli-command-manifest.ts`
- `README.md`
- `docs/architecture.md`
- focused tests under `packages/assistant-core/test/**`, `packages/query/test/**`, and `packages/cli/test/**`
- Out of scope:
- New model-running ingest/query orchestration commands such as `knowledge ingest` or `knowledge query`
- Vector search, embeddings, or a new persistence layer
- Reworking the canonical `bank/**` health record formats
- Converting `vault/AGENTS.md` into the assistant runtime schema source

## Constraints

- Technical constraints:
- Preserve the existing assistant/runtime owner boundaries: prompt behavior stays in `assistant-core`, derived-knowledge parsing stays query-owned, and CLI commands remain thin wrappers.
- Keep the command surface small and composable; prefer one narrow log-inspection command over a new family of orchestration verbs.
- Preserve current dirty-tree edits, especially adjacent assistant-core prompt/runtime work.
- Product/process constraints:
- Keep behavior aligned with Murph's product constitution: calm, low-burden, and explicit rather than over-automated or chatty.
- Follow the repo completion workflow, including a required final review audit pass and scoped dirty-tree-safe commit helper usage.

## Risks and mitigations

1. Risk: prompt changes could conflict with overlapping assistant-core work in adjacent files.
   Mitigation: keep edits localized to the knowledge guidance block and update tests to pin the new wording.
2. Risk: adding log writes could complicate the existing deterministic knowledge write path.
   Mitigation: append only on knowledge upserts, keep the log format plain Markdown, and expose a read-only CLI tail surface only.
3. Risk: `bank/library` linkage could blur the canonical-vs-derived boundary.
   Mitigation: keep library references as optional metadata only; `derived/knowledge` remains rebuildable and non-canonical.

## Tasks

1. Register the active scope in the coordination ledger and keep the plan updated as implementation choices settle.
2. Update assistant knowledge guidance so the runtime treats the first-class knowledge tools as the primary wiki-maintainer surface and encodes the intended workflow.
3. Add `derived/knowledge/log.md` support in the shared knowledge service plus a narrow `knowledge log tail` CLI read surface.
4. Add optional `librarySlugs` metadata to derived knowledge pages, validate those slugs against `bank/library`, and surface invalid links in lint.
5. Update docs and focused tests, then run the required verification and final review audit.

## Decisions

- Keep the new CLI surface minimal: add `knowledge log tail` only, and defer any operator-facing `knowledge ingest`, `knowledge query`, or `knowledge status` flows.
- Prefer the existing first-class `assistant.knowledge.*` tool surface over CLI indirection for assistant wiki-maintainer behavior.

## Verification

- Commands to run:
- `pnpm --filter @murphai/query exec vitest run test/knowledge-graph.test.ts test/health-library.test.ts --config vitest.config.ts --coverage.enabled=false --maxWorkers 1`
- `pnpm --filter @murphai/assistant-core exec vitest run test/system-prompt.test.ts --config vitest.config.ts --coverage.enabled=false --maxWorkers 1`
- `pnpm --dir . exec vitest run packages/cli/test/knowledge-runtime.test.ts packages/cli/test/knowledge-documents.test.ts --config packages/cli/vitest.workspace.ts --coverage.enabled=false --maxWorkers 1`
- `pnpm --filter @murphai/assistant-core typecheck`
- `pnpm --filter @murphai/query typecheck`
- `pnpm --filter @murphai/murph typecheck`
- Expected outcomes:
- Focused prompt, knowledge runtime, and query tests pass with the new wiki-maintainer behavior, log support, and library-link validation.
- Package-local typechecks for the touched packages pass, or any unrelated pre-existing failure is documented with evidence.
Completed: 2026-04-05
