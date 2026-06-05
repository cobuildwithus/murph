# Research supplements skill

Status: completed
Created: 2026-06-05
Updated: 2026-06-05

## Goal

- Create a repo-local `research-supplements` skill that teaches agents how to research supplement brands, collect product/ingredient facts from current web sources, deduplicate against the Murph supplement database, and upsert fresher `brand_site` rows through `MURPH_SUPPLEMENT_DB_URL`.
- Rehearse the workflow manually on Momentous so the skill reflects real scraping, schema, and import constraints.

## Success criteria

- Skill exists under `.agents/skills/research-supplements` with a concise `SKILL.md`, focused helper scripts, and any needed references.
- Database helper scripts can introspect schema without leaking the DB URL and can support one-table `brand_site` dry-run/upsert operations with duplicate-aware matching.
- Manual Momentous rehearsal records the discovered workflow gaps and shapes the skill instructions.
- Skill validation and repo-required checks pass or any unrelated blockers are documented.

## Scope

- In scope:
- Repo-local skill creation and validation.
- Safe one-table database schema inspection and import helper scripts for agents.
- A limited Momentous dry-run or import rehearsal using current web sources and `MURPH_SUPPLEMENT_DB_URL`.
- Out of scope:
- Building a new Murph production feature or hosted API.
- Changing existing supplement vault/regimen product behavior.
- Bulk importing 20 brands in this task; this task prepares the workflow.

## Constraints

- Technical constraints:
- Do not print or commit `.env.local` values or database URLs.
- Prefer direct source evidence from brand pages, product labels, Supplement Facts images, or structured data.
- Preserve existing working-tree edits and avoid active assistant/Cloudflare lanes.
- Product/process constraints:
- Supplement facts are queryable product truth; do not store them as assistant runtime state.
- The supplement DB schema is now a hard-cut one-table `supplements` shape; brand web rows use `data_origin = 'brand_site'`.
- Keep the skill lean and reusable instead of adding speculative infrastructure.

## Risks and mitigations

1. Risk: Web pages omit full Supplement Facts or hide them behind images/variants.
   Mitigation: Require evidence-grade classification and mark unknown fields instead of guessing.
2. Risk: Database schema differs from expected product/ingredient tables.
   Mitigation: Add schema-introspection and duplicate-match helpers that adapt to actual tables.
3. Risk: Fresh web data overwrites better existing data.
   Mitigation: Require source timestamps/evidence confidence and upsert only when the source is clearly fresher or higher authority.

## Tasks

1. Inspect existing supplement surfaces and external supplement DB schema.
2. Rehearse Momentous discovery, extraction, duplicate matching, and dry-run import.
3. Create `research-supplements` with helper scripts and references.
4. Remake Momentous rows as `brand_site` rows after the one-table schema refactor.
5. Validate skill files and run required repo checks.
6. Run completion review and finish the active plan.

## Decisions

- Place the skill under `.agents/skills` so Murph repo agents can discover it in this checkout.
- Import official brand web data into `supplements` with `data_origin = 'brand_site'`, `data_origin_id = <brand>:<sourceId>`, `id = data_origin_id`, and `data_origin_priority = 5`.
- Do not create per-brand `data_origin` values such as `momentous`; stale rows using that origin should be deleted in the same transaction as the replacement import.

## Progress

- Momentous was regenerated from the official Shopify feed/product pages and upserted as 79 `brand_site` rows.
- The stale `data_origin = 'momentous'` rows were deleted in the same transaction.
- Current live counts after the remake: `brand_site` 107 rows total, including 79 Momentous rows; `momentous` 0 rows; 15 Momentous rows canonicalize to DSLD by exact UPC.

## Verification

- Commands to run: skill `quick_validate.py`; `pnpm typecheck`; direct script smoke checks.
- Expected outcomes: validation passes, helper scripts run without exposing secrets, repo typecheck passes or unrelated blockers are reported.
Completed: 2026-06-05
