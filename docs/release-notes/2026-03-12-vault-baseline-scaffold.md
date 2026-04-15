# 2026-03-12 Vault Baseline Foundation

## Summary

Recorded the initial file-native vault contract foundation, then reconciled the first downstream integration pass across the executable runtime packages.

## What changed

- Froze the initial package names:
  - `@murph/contracts`
  - `@murph/core`
  - `@murph/cli`
  - `@murph/importers`
  - `@murph/query`
- Froze `vault-cli` as the only public command namespace for the vault contract.
- Documented the safe extension rules for package boundaries, canonical write authority, immutable `raw/`, append-only ledgers, and out-of-vault assistant state.
- Added the dated release-note lane for later operator-visible or contract-visible changes.
- Aligned `packages/core` write paths with the frozen contract shapes for vault metadata, frontmatter, events, samples, and audits.
- Reconciled `packages/importers` and `packages/query` against the contract-shaped core outputs.
- Wired the CLI service layer to real package functions in source instead of placeholder service stubs.
- Updated root verification docs and scripts so package-runtime checks are part of the documented repo truth.

## Verification

- `pnpm typecheck:packages`
- `pnpm test:packages`
- `node --import=tsx e2e/smoke/verify-fixtures.ts --coverage`

## Follow-up

- `pnpm test` still depends on the repo doc-drift wrapper and can fail in a large in-progress dirty worktree even when the runtime package checks are green.
- `vault-cli` source is wired, but the workspace still lacks the `incur` toolchain needed to execute or typecheck the TypeScript CLI package end to end.
