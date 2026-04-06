# Hosted Email Composability Patch

## Goal

Land the supplied hosted-email composability patch on top of the current Cloudflare worker state so hosted email routing keeps orchestration in `routes.ts` while storage, addressing, and crypto helpers move into dedicated siblings.

## Success Criteria

- `apps/cloudflare/src/hosted-email/routes.ts` sheds the extracted helper clusters without changing ingress or verified-sender ownership behavior.
- New `route-addressing.ts`, `route-crypto.ts`, and `route-store.ts` modules exist and own the extracted seams.
- `ingress-policy.ts` depends only on the addressing seam instead of the whole routes module.
- Focused tests cover the new pure hosted-email helper seams.
- Required Cloudflare verification runs, or any unrelated blocker is documented concretely.

## Constraints

- Treat the supplied patch as behavioral intent, not blind overwrite authority.
- Preserve unrelated worktree edits, including the existing coordination-ledger and active-plan changes already present.
- Keep hosted email ingress fail-closed and do not broaden trusted sender authority.

## Planned Steps

1. Register the task in the coordination ledger and inspect the live hosted-email files against the supplied patch.
2. Apply the hosted-email helper extraction and focused tests without widening behavior.
3. Run Cloudflare verification, complete the required review pass, then finish with a scoped commit.

## Verification

- `pnpm typecheck` (passed)
- `pnpm test:coverage` (failed for unrelated existing CLI package-shape guard: `packages/cli/scripts/verify-package-shape.ts` rejects a runtime dependency on `@murphai/gateway-core`)
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email-route-helpers.test.ts --no-coverage` from `apps/cloudflare` (passed)
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/hosted-email.test.ts test/hosted-email-route-helpers.test.ts --no-coverage` (passed)

Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
Completed: 2026-04-07
