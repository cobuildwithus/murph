# Hosted email settings alias

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Show each verified-email user their signed Murph email alias on `/settings`, and make that alias ready for inbound email without relying on Cloudflare sender authentication.

## Success criteria

- Settings shows the signed private email alias instead of the unauthenticated public ingress address when alias configuration is available.
- Verified-email sync persists the deterministic reply-alias lookup key alongside the verified email authorization.
- Cloudflare reply-alias registration rejects malformed alias keys.
- Shared alias derivation stays single-purpose and reusable across web and Cloudflare.
- Focused tests, typecheck, and required completion audits pass or are reported with unrelated blockers.

## Scope

- In scope:
  - Shared hosted-email reply alias token/address helpers.
  - Web verified-email sync persistence of the reply alias lookup key.
  - Settings snapshot and settings UI rendering of the private alias.
  - Focused tests for sync, snapshot/UI, and callback validation.
- Out of scope:
  - Re-enabling unauthenticated direct public email ingress.
  - Changing Cloudflare Email Workers sender-verdict behavior.
  - Adding a new Cloudflare alias provisioning API.

## Constraints

- Public inbound email remains fail-closed without an authenticated sender verdict.
- Web remains the owner of member routing state; Cloudflare only validates signed alias tokens and calls web for member resolution.
- Avoid new moving parts or persistent schema changes.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Web and Cloudflare could derive different aliases.
   Mitigation: Move route-token and address helpers into the shared hosted-email package and keep Cloudflare wrappers compatible.
2. Risk: Settings could display an alias that inbound resolution cannot map.
   Mitigation: Persist the deterministic alias key during verified-email sync before surfacing it as ready in the settings snapshot.
3. Risk: Alias callback could store invalid values.
   Mitigation: Validate the current 32-hex alias-key format at the callback boundary.

## Tasks

1. Add shared reply-alias helper and validation.
2. Persist reply alias key on verified-email sync.
3. Expose alias address in settings snapshot and UI.
4. Add focused tests.
5. Run verification, audits, and commit.

## Verification

- Passed:
  - `pnpm --filter @murphai/hosted-execution typecheck`
  - `pnpm --filter @murphai/hosted-execution test -- hosted-execution-builders-hosted-email.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage test/hosted-email-route-helpers.test.ts test/hosted-email-routes.test.ts test/hosted-email-worker-ingress.test.ts`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-sync-settings --no-coverage test/settings-email-settings.test.ts test/settings-email-sync-route.test.ts test/settings-page.test.ts test/settings-identity-link-dialog.test.tsx`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-execution --no-coverage test/hosted-execution-email-callback-routes.test.ts`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-store-config --no-coverage test/account-settings-snapshot.test.ts test/hosted-account-settings-cards.test.tsx`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --project hosted-web-onboarding-core --no-coverage test/hosted-onboarding-member-store.test.ts`
  - `pnpm --dir apps/web typecheck`
  - `git diff --check -- <scoped task paths>`
- Audits:
  - `security-privacy-review`: no findings.
  - `frontend-review`: no findings; no live browser screenshot was taken.
  - `coverage-write`: added shared hosted-email helper proof.
  - `task-finish-review`: no findings.
- Blocked/unrelated:
  - `pnpm --dir apps/cloudflare typecheck` fails in unrelated dirty tests: `test/browser-vault-refresh-coordinator.test.ts` expects `deferredCheckpointRequired` to be required, and `test/container-image-contract.test.ts` fixture is missing `runnerDestroyTimeoutMs`.
Completed: 2026-05-09
