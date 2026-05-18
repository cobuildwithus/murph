## Goal

Fix Junction hosted device-sync failures with simple provider-boundary
corrections:

- Preserve provider-manifest-shaped dirty job payloads across hosted wake
  storage/runtime handoff.
- Prevent optional Junction summary/timeseries resource 404/422 responses from
  failing the whole connection.
- Normalize Junction blood-oxygen unit aliases before importing samples.

## Constraints

- Keep logs and persisted diagnostics metadata-only; do not add raw provider
  response bodies, request bodies, user ids, account ids, secrets, local paths,
  or message content.
- Preserve unrelated dirty worktree and active hosted-runner edits.
- Prefer provider-owned manifest/schema boundaries over new bespoke conditionals.

## Plan

1. Extend hosted dirty resource records with a sanitized manifest payload while
   keeping the existing summary fields for counters and dedupe keys.
2. Rehydrate hosted runtime device-sync jobs from the manifest payload first,
   with a legacy resource-only fallback for old rows.
3. Isolate Junction optional resource failures at the resource boundary and
   emit metadata-only warnings.
4. Normalize Junction `blood_oxygen`/SpO2 unit aliases to the canonical sample
   unit.
5. Add focused regressions for dirty payload shape, runtime rehydration,
   optional resource failures, and SpO2 unit normalization.
6. Run targeted tests plus required typecheck/diff verification.

## Verification

- `pnpm --dir apps/web test -- device-sync-hosted-wake.test.ts prisma-store-dirty-connections.test.ts`
  passed.
- `pnpm --dir packages/assistant-runtime test -- hosted-device-sync-runtime.test.ts`
  passed.
- `pnpm --dir packages/device-syncd test -- junction-provider.test.ts hosted-runtime.test.ts`
  passed.
- `pnpm --dir packages/importers test -- device-providers-junction.test.ts`
  passed.
- `pnpm --dir packages/cli test -- cloudflare-hosted-e2e-workflow-guards.test.ts`
  passed.
- Focused owner typechecks for `apps/web`, `packages/assistant-runtime`,
  `packages/device-syncd`, `packages/importers`, `packages/cli`, and
  `apps/cloudflare` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff ...` over the current task file
  list passed, including `apps/cloudflare verify` and `apps/web verify`.

## State

- Complete. Security/privacy review found retention and sanitizer hardening
  gaps; processed dirty rows now clear per-resource dirty payload state after
  ack, persisted payloads drop secret-like keys, and scalar strings are capped.
- Simplify review findings were addressed by removing a redundant payload
  normalization wrapper, sharing payload-identity serialization through the
  hosted device-sync boundary, renaming the hosted-local command-count variable,
  and removing a redundant Junction timeseries user-id parameter.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
