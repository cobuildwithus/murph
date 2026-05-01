# Hosted runtime credential-union native

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Make hosted device-sync runtime execution use the credential union as the native boundary instead of carrying legacy top-level `tokenBundle` fields through snapshot, seed, and apply-update contracts.

Success criteria:

- Hosted runtime connection snapshots and seeds require `credential`.
- OAuth token material lives only under `credential.kind === "oauth_tokens"`.
- Provider-config and none credentials carry sanitized `credentialMetadata` records.
- Legacy token-bundle-only parsing/helpers are removed or renamed behind OAuth-specific helpers.
- Focused hosted-runtime/device-sync verification passes, or unrelated blockers are recorded precisely.

## Scope

In scope:

- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- Direct focused tests for the hosted runtime credential contract.

Out of scope:

- Provider implementation changes.
- Prisma schema or migration changes unless the contract edit exposes a direct type/test requirement.
- Broader device-sync source routing, webhook, or hosted runner changes.

## Decisions

- Hard-cut the hosted execution runtime wire contract to `credential`; do not keep token-bundle-only snapshots as a live hosted execution primitive.
- Keep OAuth token version fencing, but derive it from the OAuth credential snapshot/update.
- Treat provider-config and none credential metadata as sanitized records at the hosted runtime boundary.

## State

Done:

- Hosted runtime snapshot, seed, and apply-update contracts require `credential` and reject legacy top-level `tokenBundle` fields.
- OAuth token bundles are now emitted through `credential.kind === "oauth_tokens"` and helper names are OAuth-specific.
- Assistant-runtime reconciliation and hydration now use the credential union rather than token-bundle-only compatibility paths.
- Web authority runtime state reads/writes now preserve sanitized `credentialMetadata` for provider-config and none credentials.
- Web authority disconnected status-only updates no longer clear OAuth tokens without an explicit credential mutation.
- Added focused coverage for rejecting legacy top-level token bundles and persisting sanitized none credential metadata.

Verification:

- `pnpm --dir packages/device-syncd exec vitest run test/hosted-runtime.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm exec vitest run apps/web/test/device-sync-hosted-runtime-authority.test.ts --config apps/web/vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir apps/web typecheck` passed.
- `git diff --check` on the scoped working set passed.
- `pnpm --dir packages/assistant-runtime typecheck` is currently blocked by unrelated active assistant-engine automation input-summary/capture-id drift.
- `pnpm --dir packages/device-syncd typecheck` is currently blocked by unrelated active shared-oauth test context-shape drift.
- `bash scripts/workspace-verify.sh test:diff ...` is blocked by unrelated active assistant-engine automation input-summary/capture-id drift.

Now:

- Required final review rerun completed with no production correctness/security findings.

Next:

- Address any final-review findings.
- Close/archive this plan without disturbing unrelated active ledger rows.

## Working Set

```txt
packages/device-syncd/src/hosted-runtime.ts
packages/device-syncd/test/hosted-runtime.test.ts
packages/assistant-runtime/src/hosted-device-sync-runtime.ts
packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts
apps/web/src/lib/device-sync/hosted-runtime-authority.ts
apps/web/test/device-sync-hosted-runtime-authority.test.ts
```
Completed: 2026-05-01
