# WHOOP hosted runtime token snapshot

Status: completed
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Fix hosted WHOOP reconnects that stay stuck on "needs reconnect" because the
  hosted runner hydrates a tokenless device-sync runtime snapshot even though
  web has encrypted OAuth tokens for the connection.

## Success criteria

- The hosted runner can hydrate OAuth token credentials from the signed
  web-control snapshot path used during hosted execution.
- Tokenless/redacted snapshots still avoid exposing token material when
  credential material is not explicitly requested.
- A focused regression proves a fresh hosted runtime with a WHOOP OAuth
  snapshot can execute without turning the connection into reauthorization
  required solely because local tokens are missing.
- Required verification and completion workflow checks run, or any unrelated
  blockers are recorded precisely.

## Scope

- In scope:
  - `apps/cloudflare/src/runtime-platform.ts`
  - `apps/cloudflare/src/runner-outbound/web-control.ts`
  - focused Cloudflare runner tests for the web-control snapshot body
  - focused assistant-runtime/device-sync tests for fresh OAuth snapshot
    hydration
- Out of scope:
  - WHOOP OAuth callback persistence.
  - WHOOP provider API behavior beyond local token hydration.
  - Existing Junction/source-apply diagnostic work already dirty in the
    checkout.
  - Broad device-sync credential storage redesign.

## Constraints

- Do not log, fixture, or expose real tokens, provider payloads, user ids,
  local paths, or other direct identifiers.
- Keep the fix at the existing signed web-control authority boundary.
- Preserve existing behavior that non-runtime snapshots are redacted unless
  credential material is explicitly requested.
- Preserve unrelated working-tree edits.

## Risks and mitigations

1. Risk: Broadening credential exposure beyond the trusted hosted runner.
   Mitigation: only request material through the existing internal signed
   web-control device-sync snapshot path, with synthetic token tests.
2. Risk: Breaking direct signed callback mode.
   Mitigation: keep direct mode behavior unchanged and update only the proxy
   request body expectations.
3. Risk: Masking real reauth-required provider failures.
   Mitigation: test the specific missing-local-token failure path, not provider
   invalid-token responses.

## Tasks

1. Register coordination row.
2. Change the hosted runner web-control snapshot request to request credential
   material for device-sync runtime snapshots.
3. Add/update focused tests around proxied snapshot request bodies.
4. Add a runtime regression for fresh WHOOP OAuth snapshot hydration.
5. Run focused tests and app/package verification required by the routed task.
6. Run focused verification and local privacy-sensitive diff review.
7. Inspect privacy-sensitive diff and close the plan. A scoped commit was
   blocked by overlapping dirty device-sync/source-apply work in the same
   checkout.

## Decisions

- Treat this as a high-risk, narrow hosted device-sync boundary fix because it
  changes OAuth credential material flow between web and the hosted runner.
- Prefer using the existing signed web-control callback path instead of adding a
  new credential fetch or persisted bridge.

## Verification

- Passed: `pnpm exec vitest run apps/cloudflare/test/runner-outbound.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage -t "proxies allowlisted hosted web-control path: 'device-sync runtime snapshot'|upgrades device-sync runtime snapshots" --reporter=verbose`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --config vitest.config.ts --no-coverage -t "sync hydrates a fresh WHOOP OAuth runtime snapshot before running device jobs" --reporter=verbose`
- Passed: `pnpm --dir apps/cloudflare typecheck`
- Passed: `pnpm --dir packages/assistant-runtime typecheck`
- Passed: `pnpm exec vitest run apps/cloudflare/test/runner-outbound.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --reporter=dot`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --config vitest.config.ts --isolate=true --no-coverage --reporter=dot`
- Passed: `git diff --check -- apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/test/runner-outbound.test.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-05-26-whoop-runtime-token-snapshot.md`
- Local direct check: after reconnect, the app moved from reauth-required to
  connected and WHOOP data appeared. A hard-coded local DB probe later returned
  no rows, so runtime DB confirmation is inconclusive for that command and was
  not used as final proof.
Completed: 2026-05-26
