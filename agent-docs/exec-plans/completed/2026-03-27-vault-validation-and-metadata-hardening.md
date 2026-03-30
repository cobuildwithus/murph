# 2026-03-27 Vault Validation And Metadata Hardening

## Goal

- Diagnose the transient `VAULT_INVALID_METADATA` assistant failure.
- Stop `validate` from falsely requiring `manifest.json` under `raw/inbox/**`.
- Reduce the chance that vault-operator assistant runs mutate canonical vault files outside audited write paths.

## Scope

- `packages/core/src/vault.ts`
- `packages/core/test/core.test.ts`
- `docs/contracts/01-vault-layout.md`
- `packages/cli/src/assistant-cli-access.ts`
- `packages/cli/test/{assistant-cli-access.test.ts,assistant-service.test.ts}`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Findings

- Inbox persistence stores immutable `envelope.json` plus copied attachments under `raw/inbox/**`; it does not write generic raw-import manifests.
- Current vault validation incorrectly applies the generic `manifest.json` rule to all `raw/**` paths, so inbox evidence is falsely flagged.
- The transient metadata failure appears to line up with a direct, unaudited `vault.json` touch during a prior assistant turn rather than a core mutation path.

## Plan

1. Add a narrow validator exception for `raw/inbox/**` only.
2. Add a focused regression test for envelope-backed inbox evidence.
3. Document `raw/inbox/**` as the explicit exception to the generic raw-manifest contract.
4. Keep assistant vault-operator guidance explicit that canonical vault files must be changed through the CLI write surface, not direct file edits.
5. Verify with focused tests, real-vault `validate`, then repo-wide checks and required audit passes.
