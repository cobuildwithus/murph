# OpenAI Tool Runtime Parity

## Goal

Land the supplied OpenAI-compatible assistant tool-runtime parity patch so stateless provider turns get the same bounded assistant/vault tool surface as Codex-backed turns, with matching docs and regression coverage.

## Scope

- Thread bound tool-runtime context into OpenAI-compatible provider turns.
- Extend the shared assistant tool catalog with bounded runtime tools needed for parity.
- Update prompt guidance, docs, and regression tests.
- Preserve active-vault-only access and avoid replaying tool side effects through implicit retries or provider failover.

## Constraints

- Preserve adjacent unrelated work in the dirty tree.
- Keep inbox-routing catalogs read-only and exclude assistant runtime tools there.
- Run repo-required verification and completion-review audits before handoff.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/inbox-model-harness.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-robustness.test.ts packages/cli/test/assistant-daemon-client.test.ts`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
