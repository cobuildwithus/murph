# Legal Consent Patch Landing

## Goal

Land the supplied legal consent and HBNR compliance patch in the current checkout, preserving repo invariants for health-data consent, hosted API boundaries, Prisma migrations, legal artifact generation, and durable docs.

Success criteria:

- Legal docs and generated public artifacts are current and deterministic.
- Hosted consent state is persisted through Prisma with append-only event history plus current grant reads.
- Consent API routes are authenticated/authorized consistently with existing hosted member routes.
- Build/dev legal PDF generation fits the existing app scripts.
- Required verification and completion audits are run or any blockers are documented precisely.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not expose local user identifiers, home paths, secrets, or raw `.env*` contents.
- Treat supplied patch as behavioral intent, not overwrite authority.
- High-risk workflow applies because the patch touches health data, legal consent, public APIs, persisted state, and build flow.

## State

Implemented in the current checkout by porting the supplied patch intent onto the repo's current hosted-web layout. The raw patch could not apply cleanly because several files were already present or had been adapted, so the landed diff keeps the current single-file consent helper and flat versioned legal PDF artifact shape.
Required audit findings from the prior landing pass were addressed before handoff.

## Plan

1. Register scope in the coordination ledger.
2. Check and apply the patch, resolving stale docs or code conflicts manually.
3. Inspect the resulting diff against architecture, security, reliability, and hosted app patterns.
4. Run legal artifact generation plus typecheck/tests per verification policy.
5. Run required security/privacy, coverage-write, and final review audits.
6. Commit only this task's scoped paths if safe.

## Verification

- Passed: `pnpm --dir apps/web legal:pdf`
- Passed: `pnpm --dir apps/web prisma:generate`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: focused Vitest for legal consent, consent routes, legal manifest determinism, legal HTML pages/copy, consumer-health-data notice, layout legal link, browser-vault launch-consent gating, device-sync connected-health-source consent gating, and hosted Prisma migration guard.
- Passed: `git diff --cached --check`
- Failed: `pnpm --dir apps/web test` on unrelated active-checkout failures outside this legal consent scope, including experiment UI/content expectations, settings copy expectations, and a `server-only` import setup issue.
- Failed: `pnpm typecheck` on unrelated `packages/cli/test/assistant-codex.test.ts` expecting approval policy `"on-request"` where current types allow only `"never"`.

## Notes

- Existing dirty files are present before this task; do not stage or revert them unless directly owned by this plan.
- Scoped commit may be blocked by overlapping active rows on hosted account-data export/settings and shared ledger files.
- Legal consent mutation routes now use the hosted mutation origin guard.
- Revocation events intentionally store only scope, action, document versions, source, and timestamps; free-text revoke reasons are not accepted or stored.
- Browser-vault session creation requires launch-required consent, and settings device-sync connection setup requires launch-required plus connected-health-source consent.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
