# Alternating product notes + evergreen feature catalog

- Status: Active
- Date: 2026-07-07
- Owner: Claude (Fable supervises, Codex implements)
- Branch/worktree: `feat/product-notes-feature-catalog` at `/private/tmp/murph-product-notes-catalog`

## Why

The weekly `weekly-product-updates` managed automation sends a changelog note every
week. Product decision: the changelog note should land every two weeks, and in the
freed weeks the same slot should instead surface high-value Murph features this
specific user has not tried yet ("feature discovery").

Biweekly cadence is not expressible in the automation schedule model (5-field cron
with OR day-of-month/day-of-week semantics; `every` drifts and bypasses the per-vault
spread), and spread-automation schedule edits do not reconcile onto existing records.
So the chosen shape is: keep the existing weekly automation record and alternate its
content per run via a vault knowledge-page ledger. Users experience exactly the
requested cadence (changelog biweekly, discovery staggered into the other weeks) with
no schedule migration and no new automation record.

## User-visible goal

One short product note per week in the existing slot, alternating between
"what shipped in Murph recently that fits you" and "things Murph can do for you that
you have not tried", each with skip-if-hollow bars, starting with feature discovery.

## Scope

1. `apps/web/src/lib/feature-catalog.ts` — new evergreen catalog of shipped,
   user-facing Murph capabilities (25-50 items), validated at module load like
   `changelog.ts`.
2. `apps/web/app/api/feature-catalog/route.ts` — public GET feed mirroring
   `/api/changelog` conventions.
3. `packages/assistant-engine/src/assistant/managed-automations.ts` — rewrite the
   `MURPH_WEEKLY_PRODUCT_UPDATES_AUTOMATION_ID` seed (same automationId, slug,
   schedule/spread, continuity) to the alternating design.
4. Tests: update `packages/assistant-engine/test/managed-automations-core.test.ts`
   pinned assertions; add `apps/web/test/feature-catalog.test.ts` and
   `apps/web/test/feature-catalog-routes.test.ts` mirroring the changelog tests.

## Invariants to preserve

- Seed reconciliation semantics in `applyMurphManagedAutomations` unchanged; the
  spread schedule for this automation is untouched.
- The changelog feed remains the only source of shipped-truth for changelog notes;
  the catalog feed becomes the only source of feature-truth for discovery notes.
- No raw health values inspected solely for personalization.
- Ledger lives in a canonical vault knowledge page (`murph-product-notes`) via
  `vault-cli knowledge append-section`, matching the `weekly-health-insights`
  pattern including the concurrent-append race branch.
- Deliverability hard rules: no automated-outreach framing, no signup/new-user
  language, no imperative exact-send phrasing; text-only announcement.
- Catalog items must describe only shipped features, each verifiable against
  changelog editions or product docs; copy follows repo copy rules (no em dashes,
  explain proprietary names, no overclaimed policy/security claims).

## Deployment concerns

Vercel web (catalog route) must deploy before the Cloudflare runner rollout that
carries the new seed instructions, since the instructions fetch
`/api/feature-catalog` at run time. Instructions also degrade safely (skip) if the
feed is unavailable.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
