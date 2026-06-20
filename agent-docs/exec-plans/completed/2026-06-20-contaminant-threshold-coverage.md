# Improve contaminant threshold coverage

Status: completed
Created: 2026-06-20
Updated: 2026-06-20

## Goal

- Increase exact-product contaminant concern coverage for foods where Murph has
  measured product-test rows, especially PlasticList rows, while preserving the
  no-inference invariant for threshold applicability.

## Success criteria

- Reviewed exact product threshold applications point at threshold rows that
  are already normalized to product-mass comparison units at import time.
- One-consumption-unit-per-day assumptions, when used, are encoded in generated
  application-only threshold data and review notes instead of SQL transforms.
- Threshold seed/import tooling can repair the current partial rollout without
  relying on uncommitted bulk snapshots for the reviewed applications it ships.
- Runtime labels keep source measurements separate from Murph threshold
  interpretation and do not claim PlasticList authored "high" unless that
  source classification exists.

## Scope

- In scope:
  - `apps/web` product-test threshold schema/import/runtime/test surfaces.
  - Minimal committed seed data required by reviewed threshold applications.
  - Dry-run/postflight scripts or assertions that prevent another zero-join
    partial rollout.
- Out of scope:
  - Fuzzy product, category, ingredient, or brand threshold inference.
  - Legal/compliance determinations such as Prop 65 compliance claims.
  - Broad UI redesign or multi-threshold ranking UX.
  - Large regulatory data warehouse abstractions.

## Constraints

- Technical constraints:
  - Product-test rows store product-mass concentrations; any daily-exposure
    source threshold used for product alerts must be transformed before import
    into an application-only product-mass threshold row.
  - Reviewed applications must reference exact `food_id` or `supplement_id`
    targets and active threshold rows.
  - Bulk threshold snapshots may remain local, but any committed reviewed
    application needs committed importable prerequisite threshold data.
- Product/process constraints:
  - Preserve the user-facing distinction between a source measurement and
    Murph's threshold-based interpretation.
  - Keep the architecture clean and composable: prefer normalized data plus
    import assertions over SQL-side exposure transforms, classifiers, or broad
    new services.

## Risks and mitigations

1. Risk: daily exposure thresholds are applied to the wrong route or serving.
   Mitigation: encode the route, consumption mass, and assumption in generated
   application-only threshold IDs/names/review notes and keep them out of global
   fallback lookup.
2. Risk: more threshold data creates false confidence through category matches.
   Mitigation: keep applicability in reviewed exact-product rows only.
3. Risk: rollout imports applications before prerequisite thresholds.
   Mitigation: ship required threshold seed data and postflight assertions in
   one ordered import path.

## Tasks

1. Send a focused follow-up to ReviewGPT/Pro asking for a scoped patch/data plan
   and loop on any unclear advice.
2. Inspect current schema, import scripts, runtime query, tests, and live labels
   DB shape for threshold/application coverage.
3. Implement minimal schema/import/runtime support for application-only
   normalized thresholds if still justified after inspection.
4. Add committed prerequisite threshold seed data and ordered repair/dry-run
   assertions for reviewed applications.
5. Add focused tests for import validation, runtime comparison semantics, and
   rollout/postflight behavior.
6. Run required verification and completion audits, then commit through
   `scripts/finish-task`.

## Decisions

- Daily exposure thresholds, if added, belong in generated application-only
  threshold rows with normalized product-mass values, not in `product_tests` or
  SQL-side derivation.
- No category or product-name inference will be added.
- Runtime should read `contaminant_thresholds.normalized_*` directly for exact
  applications rather than deriving concentration comparability from raw units.
- `comparison_scope = 'reviewed_application'` keeps generated exact-product
  thresholds out of global fallback while allowing them to carry normalized
  comparison values.
- `comparison_scope` has no persistent database default. Future generated rows
  must state their scope explicitly instead of silently leaking into global
  fallback.
- The committed reviewed threshold CSV carries explicit `normalized_*` columns.
  `reviewed_application` rows preserve those values exactly; only `global`
  rows get automatic concentration normalization.
- The committed reviewed bundle runner is seed-specific and runs schema,
  threshold import, application replacement, orphan deactivation, and postflight
  in one database transaction. The lower threshold/application importers remain
  the custom-path entrypoints.

## Verification

- Commands to run:
  - Focused product-test SQL/script tests discovered during implementation.
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` when the diff
    is stable.
  - Direct dry-run/readback SQL against the labels DB using the secret-safe
    labels DB helper, without printing secrets.
- Expected outcomes:
  - Tests prove application-only normalized thresholds do not become global
    fallbacks and still power exact reviewed product alerts.
  - Dry-run/postflight shows nonzero exact joins for committed reviewed
    applications when prerequisite threshold data is present.

## Progress

- Focused tests passed:
  `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-lib.test.ts apps/web/test/supplements-lib.test.ts apps/web/test/product-label-runtime-env.test.ts`
- Transaction dry-run against the labels DB applied schema, required thresholds,
  reviewed applications, and postflight in one psql session ending with
  `ROLLBACK`. It also proved reviewed-application normalized values survive a
  schema rerun while stale global non-comparable normalized values are cleared.
  Postflight found 3 active reviewed thresholds, 3 reviewed applications, and 5
  exact comparable product-test joins. RXBAR `fdc:705844` BPA readback exceeded
  the named Murph EFSA 52 g/day adult screening threshold (`0.0022 ppm` vs
  `0.000269230769 ppm`).
- Re-ran that dry-run after the wrapper was changed to embed the imports inside
  one transaction; outcome stayed the same and rolled back cleanly.
Completed: 2026-06-20
