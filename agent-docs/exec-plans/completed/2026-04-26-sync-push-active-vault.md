# Sync Push Active Vault

## Goal

Make `murph sync push --session ...` use the selected active vault like other product CLI commands, so hosted Settings can keep rendering a clean command without `--vault`.

## Scope

- `packages/operator-config/src/operator-config/cli-vault-defaults.ts`
- `packages/operator-config/test/operator-config-seam.test.ts`
- `packages/runtime-state/src/hosted-bundle.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- `packages/cli/src/commands/sync.ts`
- `apps/cloudflare/src/hosted-bundle-validation.ts`
- `apps/cloudflare/test/runner-bundle-helpers.test.ts`
- Directly coupled CLI wrapper tests only if static/focused proof shows they are needed

## Constraints

- Preserve raw `vault-cli` explicit-vault behavior.
- Do not expose local vault paths, pairing tokens, sync payload contents, secrets, or personal identifiers in committed files or handoff.
- Keep the fix in the wrapper command classification, not in hosted Settings command generation.
- Large local canonical files must be handled without printing file paths or contents.
- `sync push` output must not include the resolved local vault path.

## Verification Plan

- Focused operator-config test for active-vault injection on `sync push`.
- Focused runtime-state test for large inline bundle base64 validation.
- Focused Cloudflare validator test for large inline bundle base64 validation.
- Direct sync dry-run output check that does not print a local vault path.
- Scoped `test:diff` for touched files if available.
- `pnpm typecheck` unless blocked by unrelated active work.
- Direct local dry-run/proof that `murph sync push` no longer fails before vault injection, without printing sensitive paths.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
