Goal (incl. success criteria):
- Fix assistant CLI bootstrap so dev/runtime agents see exact hot canonical-save command shapes for onboarding persistence without broad `--help` discovery.
- Success: compact assistant CLI contract includes `memory upsert` required flags and key `goal save` optional fields from command schemas; regression tests cover enrichment.

Constraints/Assumptions:
- Preserve unrelated dirty work and active ledger rows.
- Do not edit the active onboarding skill prompt row unless code evidence requires it.
- Keep bootstrap lightweight; avoid injecting the full root `--llms-full` manifest into turns.

Key decisions:
- Enrich compact `vault-cli --llms --format json` with targeted leaf `--schema --format json` data for hot persistence commands.

State:
- In progress.

Done:
- Traced compact manifest and confirmed it omits schemas for `memory upsert` and `goal save`.

Now:
- Patch assistant-engine CLI surface bootstrap and tests.

Next:
- Run focused assistant-engine tests, typecheck, required audit/review path, and commit if unblocked.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the currently running dev agent needs restart to pick up source changes.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts`
- `packages/assistant-engine/src/assistant/cli-surface-manifest.ts`
- `packages/assistant-engine/test/assistant-cli-surface-bootstrap.test.ts`
- `agent-docs/exec-plans/active/2026-06-06-assistant-cli-save-schema-bootstrap.md`
