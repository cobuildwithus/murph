# Keep knowledge sources valid after ledger compression

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Outcome: research updates can save their findings after referenced event ledgers are compressed.
- Reaches: existing knowledge pages, new source references, and knowledge lint.
- Proof: storage-transition regressions and the focused real-Codex research journey.

## Success criteria

- Preserve logical `.jsonl` source references across plain, gzip, and Brotli storage.
- Reject absent, ambiguous, non-file, and symlinked sources before any write.
- Pass focused tests and assistant-engine typecheck; inspect the live research outcome.

## Scope

- In scope: knowledge source validation, regression evidence, and release note.
- Out of scope: production mutations, delivery route changes, scheduling policy, and deployment.

## Constraints

- Reuse the core event-ledger source resolver and assistant vault path safety checks.
- Validate filesystem metadata without decompressing shards or changing source references.
- Use synthetic fixtures only; keep private diagnostic evidence out of repository artifacts.

## Risks and mitigations

1. Compressed fallback could bypass path safety or conceal ambiguous storage.
   Mitigation: resolve the physical source through the existing vault guard and test rejected states.

## Tasks

1. Completed: reproduce compression failures in source validation and lint.
2. Completed: resolve logical event sources through the existing core storage owner.
3. Completed: exercise the real research knowledge write path and repeat suppression.
4. Completed: focused verification and parent review; close with a scoped commit.

## Decisions

- Synthetic reproduction confirmed that the core reader succeeds after compression while knowledge append, upsert, and lint reject the same logical source.
- Reuse the existing core resolver in one metadata check shared by writes and lint; no schema, migration, compression, or scheduling change is needed.
- This is a local fix and scoped commit. The release note has no source PR number until a PR is created; deployment and production recovery are separate.

## Verification

- `pnpm --filter @murphai/assistant-engine test test/knowledge-service.test.ts`: 23 passed. Before the fix, gzip, Brotli, and ambiguous-source regressions failed.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed, including the live journey fixture.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/knowledge-runtime.test.ts`: 13 passed.
- Actual source CLI smoke: append succeeded against a Brotli-backed logical source; readback preserved the original finding, new finding, and source reference.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`: 10 passed. The documented app-directory invocation found no tests; the repository-root invocation uses the configured include paths (existing Frog entries cover this mismatch).
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed; source maximum remains 18 with no functions above 20.
- Parent diff review and added-content privacy scan: passed. Existing path containment, forbidden source roots, canonical write locks, and logical source ownership are preserved. No new dependency or source-content read was added.
- `pnpm test:assistant:live -- --test "saves research with compressed ledger sources and suppresses repeated research" --codex-home <LOCAL_CODEX_HOME>`: passed on `gpt-5.6-terra` with local subscription authentication after the documented startup-only alternate-home retries. Fresh research: one retrieval, one real knowledge write, one final message. Repeated research: one retrieval, zero writes, silent finish, unchanged complete page. The fixture uses real knowledge CLI commands and synthetic research results. Local source-CLI probes use `TSX_TSCONFIG_PATH=tsconfig.base.json`; the fixture's existing contracts-package prerequisite was built before the successful run.
- Product UX verdict: Ready. Reviewed both synthetic outcomes: useful concise learning without a question or extra task; repeat suppression without an acknowledgement. This proves local assistant behavior and persistence, not hosted scheduling or provider delivery. An initial readback assertion incorrectly compared a formatted page to bare fixture prose; it was corrected to compare complete before/after Markdown, and the final run passed.
- Final scope: one production service module, focused deterministic and live regressions, release note, and this plan. No new owner or runtime protocol; PR-specific CI and external review await any future pushed candidate.
Completed: 2026-09-13
