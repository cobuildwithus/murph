# Device-sync metadata storage guard

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Close the remaining storage-side gap so device-sync metadata writes no longer persist arbitrary or oversized JSON through local `metadataPatch` merges or hosted internal runtime metadata updates.

## Success criteria

- Local SQLite account writes sanitize metadata before persistence, including connect-time writes, hosted hydration, patch merges, and `metadataPatch` merges.
- Hosted Prisma writes sanitize metadata before persistence, including public connect-time writes and hosted internal runtime apply updates.
- The sanitizer is shared and deterministic so public redaction and internal-runtime behavior keep working while nested or oversized metadata is dropped instead of stored.
- Focused tests cover the local provider-path and hosted internal-runtime/Prisma-path regressions.

## Scope

- In scope:
- Add one canonical device-sync metadata sanitizer with compact shallow-value limits.
- Route local and hosted storage owners through that sanitizer.
- Update focused tests and the durable security doc for the new trust-boundary rule.
- Out of scope:
- Broader device-sync schema redesign.
- New public metadata fields or a richer metadata contract.

## Constraints

- Preserve unrelated dirty-tree edits in the same files and build on top of the in-flight metadata work.
- Keep metadata semantics intentionally narrow: small diagnostic fields only, not provider profile payloads or arbitrary nested JSON.
- Use the standard high-risk workflow: full repo baseline verification, required final audit pass, and `scripts/finish-task`.

## Risks and mitigations

1. Risk: Over-sanitizing breaks existing internal runtime sync fields that still rely on simple metadata.
   Mitigation: Keep the sanitizer permissive for shallow scalar keys and add focused tests around existing simple metadata values.
2. Risk: Existing in-flight edits in the same device-sync files get clobbered.
   Mitigation: Read current diffs first, patch narrowly, and commit only the exact touched paths.

## Tasks

1. Add the canonical sanitizer and wire it into the hosted and local storage write paths.
2. Add focused regression tests plus the durable security rule update.
3. Run required verification, complete the mandatory review pass, and close the plan through `scripts/finish-task`.

## Decisions

- Device-sync account metadata is bounded internal diagnostic state, not a free-form provider payload store.
- Storage writes should sanitize invalid metadata down to a compact shallow record instead of failing the whole sync path for optional metadata.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Device-sync storage writes keep simple scalar metadata and drop nested or oversized values across both local and hosted paths.
Completed: 2026-04-01
