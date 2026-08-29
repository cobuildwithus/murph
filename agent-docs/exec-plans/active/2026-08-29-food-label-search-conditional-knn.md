# Prevent branded food label search timeouts

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Keep private branded food-label searches within the existing eight-second
  database statement budget so meal capture can use label-backed nutrition
  instead of receiving a retryable hosted API failure.

## Success criteria

- A deterministic PostgreSQL regression proves that the expensive nearest-name
  branch is skipped when indexed full-text retrieval is exhaustive below its
  cap and remains available when the cap is saturated.
- Representative synthetic branded-cracker searches complete successfully
  against the configured labels database under the production timeout.
- Existing food-label ranking, exact-id/UPC lookup, generic-food search, and
  contaminant attachment contracts remain unchanged.
- Focused Web tests and typecheck pass, exact-head CI is green, and required
  review gates resolve with no accepted findings.

## Scope

- In scope: private food-name search SQL, its focused PostgreSQL/unit coverage,
  the member-facing changelog, and the owning product-label documentation.
- Out of scope: label imports, database schema changes, new indexes, supplement
  ranking, public product search, CLI error semantics, and assistant prompts.

## Constraints

- Technical constraints: retain the current pool, indexes, 10,000-row retrieval
  caps, deterministic ranking, and eight-second statement timeout; add no new
  dependency or runtime owner.
- Product/process constraints: use only synthetic reproduction queries in
  durable artifacts, preserve the active contaminant-data plan, and ship from
  an isolated worktree without modifying the older overlapping draft PR.

## Risks and mitigations

1. Risk: skipping nearest-name retrieval could reduce recall for a full-text
   query whose GIN candidate set was truncated.
   Mitigation: skip it only when the materialized full-text set is below the
   existing cap, which proves that set was not truncated.
2. Risk: a planner rewrite could still execute the expensive GiST scan.
   Mitigation: inspect the real labels-database plan and assert the generated
   SQL places the cap-saturation predicate inside the KNN input branch.

## Tasks

1. Correlate the alert with safe runtime evidence and reproduce the exact
   `search_rows` timeout class against the configured labels database.
2. Profile the production SQL and prove the root-cause branch.
3. Make nearest-name retrieval conditional on full-text cap saturation and add
   focused regression coverage.
4. Run deterministic and real-database proof, update member-facing docs, and
   complete the PR review/CI workflow.

## Decisions

- Root cause: unsaturated full-text searches still materialize 10,000 whole-
  catalog GiST nearest-name rows before filtering them back to the small FTS
  set. A synthetic branded-cracker query spent about 10.9 seconds in that scan
  and exceeded the production eight-second statement timeout with PostgreSQL
  code `57014`.
- The smallest correction is to run that KNN branch only when the bounded FTS
  set reaches its 10,000-row cap; no schema, index, timeout, retry, or fallback
  change is needed.

## Product UX Patch

- Outcome: an existing private meal-capture journey receives a matching branded
  food label instead of a retryable service-unavailable result.
- Reaches: current private assistant turns that call `food search-labels`; no
  new audience, surface, data source, permission, or reply policy is added.
- Proof: the same representative branded-cracker search class that canceled at
  eight seconds returns a label under the unchanged production timeout.
- Walkthrough: `Ready`. Five representative food searches returned one matching
  label each against the configured labels database; the two pre-fix timeout
  cases completed in 54 ms and 59 ms after the change. Exact ID, UPC, generic,
  saturated-FTS, and typo recovery remain covered by focused tests. No behavior
  differed from the plan.

## Verification

- Commands to run: focused product-label unit and PostgreSQL tests, Web
  typecheck, a safe labels-database reproduction using representative synthetic
  searches, and exact-head CI plus routed ReviewGPT gates.
- Expected outcomes: focused checks pass; affected searches return inside the
  statement budget; unsaturated plans show zero loops for the nearest-name GiST
  scan; saturated fixtures preserve current ranked recall.
