# Harden hosted email alias key entropy

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Harden hosted email stable reply-alias keys so newly generated aliases carry at least 128 bits of routing-key entropy while old aliases continue resolving during migration.

## Success criteria

- New hosted email reply aliases use a versioned route-token format.
- New stable alias lookup keys carry at least 128 bits of HMAC-derived entropy without exceeding the email local-part budget for the default hosted email local part.
- Legacy `u-...` route tokens continue to parse and verify.
- Inbound legacy 64-bit alias keys still resolve after a member has registered the newer longer key, unless the prefix lookup is ambiguous.
- Focused hosted email tests cover new token length, legacy token parsing, and legacy lookup fallback.
- Required verification and audits pass or unrelated blockers are documented.

## Scope

- In scope:
  - `apps/cloudflare` hosted email route crypto/addressing and directly coupled tests.
  - `apps/web` hosted reply-alias lookup fallback and directly coupled tests.
- Out of scope:
  - Editing `apps/cloudflare/src/hosted-email/routes.ts` or the web resolve-route handler while the active sender-auth lane owns them.
  - Database schema changes unless unavoidable for safe migration.
  - Hosted email product UX changes.
  - Broad hosted email ingress or transport refactors.

## Constraints

- Technical constraints:
  - Preserve unrelated active hosted Cloudflare/web rows and dirty work.
  - Do not log or fixture real email addresses, member ids, aliases, headers, or secrets.
  - Keep existing legacy aliases working through the migration path.
- Product/process constraints:
  - Hosted email aliases remain routing hints, not authority; web-owned verified-owner checks still gate route resolution.
  - Keep the change narrow and directly tested.

## Risks and mitigations

1. Risk: Increasing hex lengths breaks email local-part limits for plus aliases.
   Mitigation: use compact HMAC-derived encoding for the new token while preserving at least 128 bits.
2. Risk: Re-registering a new alias key overwrites the only web lookup key and breaks replies to old aliases.
   Mitigation: keep exact lookup for old rows and add bounded legacy-prefix lookup for old 64-bit keys against new rows, rejecting ambiguous matches.
3. Risk: Legacy fallback could widen routing authority.
   Mitigation: only allow fallback for strict 16-hex legacy keys and still require sender authorization after lookup.

## Tasks

1. Implement versioned hosted email route tokens and 128-bit stable alias keys.
2. Keep legacy route-token parse/verification alive.
3. Add web lookup fallback for strict legacy alias-key prefixes.
4. Add focused tests for the crypto and lookup migration behavior.
5. Run scoped verification and required completion audits.
6. Commit the scoped fix and close this plan.

## Decisions

- Use compact fixed-width lowercase base36 route-token segments for the new token so 128-bit key entropy and the existing 128-bit signature fit the default plus-address shape.
- Avoid editing hosted email route orchestration files owned by the active sender-auth lane.

## Verification

- Commands to run:
  - Focused Cloudflare hosted email route helper tests.
  - Focused web hosted member-routing tests.
  - `pnpm typecheck`
  - `git diff --check`
  - Required security/privacy, coverage, and finish-review audits.
- Expected outcomes:
  - Focused checks pass; repo-wide blockers, if any, are documented as unrelated.
- Results:
  - PASS: `pnpm exec vitest run apps/cloudflare/test/hosted-email-route-helpers.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage` (12 tests).
  - PASS: `pnpm exec vitest run apps/web/test/hosted-onboarding-member-store.test.ts --config apps/web/vitest.config.ts --no-coverage` (40 tests, after coverage-write added exact-upgraded-key proof).
  - PASS: `git diff --check -- apps/cloudflare/src/hosted-email/route-crypto.ts apps/cloudflare/test/hosted-email-route-helpers.test.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/test/hosted-onboarding-member-store.test.ts agent-docs/exec-plans/active/2026-04-25-hosted-email-alias-key-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
  - FAIL unrelated: `pnpm typecheck` reached `apps/web` typecheck and failed in active unrelated `apps/web/src/lib/hosted-onboarding/linq-typing-diagnostic.ts` and its tests.
  - FAIL unrelated after Cloudflare passed: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/hosted-email/route-crypto.ts apps/cloudflare/test/hosted-email-route-helpers.test.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/test/hosted-onboarding-member-store.test.ts` passed dependency policy, workspace boundary checks, hosted stale-name guard, and `apps/cloudflare verify`, then failed in `apps/web verify` because dev smoke timed out while `/api/internal/health` returned 404.
Completed: 2026-04-25
