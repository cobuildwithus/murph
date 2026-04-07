# Hard-cut hosted share page preview ownership to Postgres

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make hosted share page and status reads self-sufficient from Postgres metadata so Cloudflare storage only holds the opaque share pack needed at acceptance/import time.

## Success criteria

- `HostedShareLink` persists the full hosted share preview metadata needed for page/status reads.
- Share creation writes that preview metadata in the same Postgres row create that owns expiry and lifecycle facts.
- `buildHostedSharePageData()` no longer falls back to reading the Cloudflare-backed share pack.
- Acceptance still fails closed when the Cloudflare-backed opaque share pack is missing at import time.
- Focused tests cover the new metadata ownership split and the narrowed runtime dependency.

## Scope

- In scope:
- Add the hosted-share preview JSON field and migration.
- Update hosted share create/read helpers and the signed internal create route.
- Update focused hosted share and hosted-execution contract tests plus durable docs.
- Out of scope:
- Reworking the Cloudflare share-pack storage format or the share acceptance dispatch contract.
- Broadly redesigning hosted share issuance callers outside the minimal contract changes needed here.

## Constraints

- Keep Cloudflare as the owner of the opaque share pack payload used at acceptance/import time.
- Keep page/read metadata ownership in Postgres only: preview, expiry, lifecycle, and recipient-facing state.
- Preserve unrelated dirty worktree edits in active hosted lanes.

## Risks and mitigations

1. Risk: Existing rows created before the new preview JSON field could break page reads.
   Mitigation: Backfill the preview JSON in the migration from the existing preview title so legacy rows stay readable.
2. Risk: The internal create contract could drift between issuer and web route.
   Mitigation: Keep the route contract covered by the existing hosted-share issuer and route tests.
3. Risk: The accept path could accidentally lose the fail-closed Cloudflare pack validation.
   Mitigation: Leave the acceptance read path intact and preserve the missing-pack regression test.

## Tasks

1. Add `previewJson` to hosted share persistence and backfill existing rows.
2. Remove the page/status preview fallback to `readHostedSharePack(record).pack`.
3. Update route/client tests and docs to reflect the new ownership split.
4. Run focused verification, capture direct scenario proof, perform the required audit, and finish with a scoped commit.

## Decisions

- Compute the preview from the share pack at creation time and persist it in Postgres rather than requiring Cloudflare reads for previews.
- Keep share-pack read/write/delete control routes for the acceptance/import lane only; the preview lane no longer depends on them.
- Backfill legacy rows to a minimal preview derived from the stored title instead of inventing a second runtime fallback path.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts hosted-share-service.test.ts hosted-share-internal-create-route.test.ts hosted-share-import-complete-route.test.ts hosted-execution-contract-parity.test.ts`
- `pnpm --dir packages/hosted-execution exec vitest run test/hosted-share-issuer.test.ts test/hosted-execution.test.ts`
Completed: 2026-04-07
