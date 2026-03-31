# Hosted device-sync metadata redaction

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Land the supplied security fix so outward-facing hosted and local public device-sync account responses no longer expose provider/profile metadata, while internal runtime and token-bundle paths still retain the full stored record they need.

## Success criteria

- Public hosted device-sync reads redact `metadata` instead of returning provider profile payloads or other raw provider diagnostics.
- Hosted internal runtime snapshot/apply helpers still use an internal mapping path so runtime state synchronization keeps full metadata when needed.
- Oura and WHOOP connect-time flows stop persisting raw provider profile/body-measurement metadata by default.
- Focused tests prove the redaction boundary and required verification passes, or any unrelated failure is documented with a scoped defense.

## Scope

- In scope:
- Add the public-account redaction helper and route public account serialization through it.
- Split hosted Prisma account mapping into public and internal variants.
- Update provider and service tests to reflect the redacted public surface and preserved internal state path.
- Out of scope:
- Broader device-sync schema redesign.
- Non-device-sync security cleanups found outside the supplied patch.

## Constraints

- Technical constraints:
- Preserve the current token bundle and internal runtime behavior for hosted execution flows.
- Keep the diff narrow and avoid unrelated edits in the already dirty worktree.
- Product/process constraints:
- Use the coordination ledger and close the task through the standard commit path.
- Run the required audit pass(es) and required verification for the touched `apps/web` and `packages/device-syncd` surfaces.

## Risks and mitigations

1. Risk: Over-redacting could break hosted runtime reconciliation that still needs internal metadata.
   Mitigation: Keep a distinct internal mapper for runtime/bundle paths and add focused tests around public vs internal reads.
2. Risk: Existing dirty-tree changes in adjacent runtime files could be overwritten.
   Mitigation: Apply only the supplied delta, inspect the resulting diff, and scope the commit to the touched files only.

## Tasks

1. Register the security patch lane and land the supplied device-sync metadata redaction delta.
2. Run required verification plus the required audit review pass(es) for this trust-boundary change.
3. Commit only the touched files with the closed plan artifact and hand off the verification evidence.

## Decisions

- Treat provider/account metadata as internal-only unless a specific public field is explicitly carved out later.
- Keep internal hosted runtime and decrypted bundle helpers on the full internal account record instead of rebuilding metadata elsewhere.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Hosted web and device-sync tests pass with public reads redacted and internal runtime paths preserved.
Completed: 2026-04-01
