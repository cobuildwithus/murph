Goal (incl. success criteria):
- Refactor assistant system prompt composition so the common route begins with a byte-stable cacheable prefix before dynamic user/date/session context.
- Stabilize assistant tool ordering for OpenAI-compatible requests and add regression tests for prompt prefix stability, cache metadata, and tool catalog stability.

Constraints/Assumptions:
- Preserve existing prompt wording and behavior where possible.
- Wearable device-connect availability/providers are deployment-stable for this task.
- Do not overwrite unrelated dirty work in the shared checkout.
- Do not include user identifiers, local account names, home paths, secrets, or raw credentials in code, tests, docs, commits, or handoff.

Key decisions:
- Keep the public `buildAssistantSystemPrompt` API compatible while introducing small layer/cache metadata helpers.
- Use deterministic hashes over static prompt text, route-stable prompt text, and sorted tool schemas for cache-stability tests.
- Sort bound assistant tools by canonical name at catalog construction.
- Do not send provider-specific prompt cache keys. OpenAI prefix caching is automatic; provider-specific cache controls should stay outside the portable prompt abstraction unless a future adapter needs them.

State:
- Complete; safe scoped commit blocked by overlapping dirty work in the shared checkout.

Done:
- Reviewed routing, verification, completion, and security docs.
- Split assistant conversation and notification prompts into static core, route-stable capability text, and dynamic turn context.
- Added prompt cache metadata and a stable-prefix regression test with inline metadata snapshot.
- Added deterministic assistant tool ordering, schema hash helpers, and web/no-web hash coverage.
- Tightened tool hash lookup so prompt-cache tool schema hashing cannot silently fall back to metadata-only tool specs.
- Addressed final-review test gaps by comparing the whole stable prefix up to the dynamic boundary.
- Ran `pnpm --dir packages/assistant-engine exec vitest run test/model-behavior.test.ts test/assistant-cli-tool-catalog.test.ts test/provider-turn-runner.test.ts test/provider-continuity.test.ts --update` successfully.
- Ran `pnpm --dir packages/assistant-engine typecheck` successfully.
- Ran `pnpm --dir packages/assistant-engine exec vitest run test/model-behavior.test.ts test/assistant-cli-tool-catalog.test.ts test/provider-turn-runner.test.ts test/provider-continuity.test.ts test/provider-execution.test.ts --update` successfully after audit fixes.
- Ran `pnpm --dir packages/assistant-engine test` successfully after audit fixes.
- Ran `git diff --check -- <touched assistant-engine files and plan>` successfully after audit fixes.
- Ran `pnpm typecheck` successfully before audit fixes; later package typecheck passed after audit fixes.
- `bash scripts/workspace-verify.sh test:diff <touched assistant-engine files>` passed through affected assistant packages but failed in reverse-dependent `packages/cli/test/inbox-incur-smoke.test.ts` because `vault-cli --help` timed out after 60s.
- `pnpm --dir packages/assistant-engine test:coverage` ran all assistant-engine tests successfully but failed existing global branch thresholds in `src/assistant/cron/current-thread-reminder.ts` and `src/assistant/execution-context.ts`.
- Required simplify, security/privacy, coverage-write, and task-finish audit subagents ran. Security/privacy found no issues. Simplify/task-finish findings were addressed except the accepted public metadata field name and shared stable-stringify cleanup.
- Follow-up simplification removed provider-specific prompt cache key plumbing and kept only the stable prefix, deterministic tool schema hash, and prompt metadata assertions.

Now:
- Close the active plan without a scoped commit because touched files and the shared ledger overlap unrelated active dirty work.

Next:
- Hand off with verification and commit-block notes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/providers/{types,registry,openai-compatible}.ts`
- `packages/assistant-engine/src/model-harness.ts`
- `packages/assistant-engine/src/model-harness/tool-catalog.ts`
- `packages/assistant-engine/test/assistant-cli-tool-catalog.test.ts`
- `packages/assistant-engine/test/model-behavior.test.ts`
- `packages/assistant-engine/test/{provider-continuity,provider-execution,provider-turn-runner}.test.ts`
- focused assistant-engine tests/typecheck above
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
