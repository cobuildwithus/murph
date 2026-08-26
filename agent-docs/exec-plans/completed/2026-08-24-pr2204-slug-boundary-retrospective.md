# PR 2204 scheduled-log slug-boundary retrospective

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Resolve the accepted ReviewGPT round-5 retrospective for PR #2204 without a
new state owner: preserve scheduled logs already admitted by the shipped
160-character core boundary, and reject an invalid derived daily-food schedule
before the command writes its food record or audit entry.

## Evidence

- The shipped core slug normalizer accepts 160 characters and was the canonical
  scheduled-log writer and reader before this PR.
- The scheduled-log contract alone used a 120-character maximum. Applying that
  narrower schema to the core and query readers would strand records with
  121–160-character slugs that the shipped writer already admitted.
- `addDailyFoodRecord` currently persists the food and its audit entry before
  deriving and validating `auto-log-<food-slug>`, so a schedule failure can
  leave a partial command result.
- Core already owns the generated daily-food scheduled-log slug builder and the
  canonical slug normalizer. Reusing that pure validation path before the food
  write is sufficient; no transaction coordinator, migration, or dual reader
  is needed.

## Product UX patch

- Outcome: `food schedule` either creates both the remembered food and its
  daily scheduled log, or returns a recoverable validation error before either
  durable write begins.
- Reaches:
  - A new food whose generated scheduled-log slug fits the canonical boundary.
  - A new food whose generated slug is too long, followed by a corrected retry
    using an explicit shorter slug.
  - An existing food whose persisted slug is too long, followed by correction
    through the existing `food rename` owner and a successful schedule retry.
  - A vault containing a previously admitted 121–160-character scheduled-log
    slug while canonical cron work is listed.
- Proof:
  - Public CLI coverage snapshots the complete vault before rejection, then
    proves a shorter-slug retry succeeds.
  - Core and contract boundary coverage proves 160 succeeds and 161 fails.
  - Canonical cron listing proves a 160-character scheduled log remains visible
    alongside other canonical work.

## Tasks

1. Give the stored scheduled-log record slug its canonical 160-character
   maximum while retaining the 120-character action and tag slug bounds.
2. Export and reuse core's daily-food scheduled-log slug builder before the
   first durable write in `addDailyFoodRecord`.
3. Update boundary tests and add public command plus canonical cron loader
   regression proof.
4. Run focused tests and package typechecks, inspect the complete diff, close
   this plan in the scoped commit, push the exact candidate, and update the PR.
5. Hand the exact pushed candidate to the parent for ReviewGPT round 6 in the
   original Hercules lineage; ReviewGPT is intentionally not launched from
   this implementation turn.

## Constraints

- Preserve existing 121–160-character scheduled-log records without migration,
  compatibility writer, or dual parser.
- Keep direct food upserts and direct scheduled-log upserts independently
  usable; only the public combined command promises the coupled outcome.
- Preserve field-specific, payload-safe recovery details and avoid echoing
  rejected user content.
- Add no queue, coordinator, state machine, dependency, or persisted marker.

## Verification

- Exact corrected foundation head `b9cc56610ff5fb1d37b6d43cbc4e058285d1b32c`
  merged without conflicts. All 12 held task-file blob hashes matched before
  and after integration.
- Focused contracts, core, query, use-case, CLI, and assistant canonical-cron
  proof passed: 6 files, 74 tests.
- Typechecks passed for contracts, core, query, vault-usecases, CLI, and
  assistant-engine. Contract schema artifacts and examples verified.
- CLI package shape passed after regenerating the required model-visible skill
  hash. No other CLI generated artifact changed.
- Canonical hosted runner assembly and every CLI parity probe passed. Vault CLI
  measured 9,476,488 / 9,479,687 bytes, with 805 / 20,000 entry bytes and
  25,155 / 33,200 static-startup bytes. The runner measured 11,278,814 /
  11,393,617 bytes.
- `git diff --check`, added-line and untracked privacy/credential/unsafe-cast
  scans, and the clean raw source-bundle guard passed.
- The Frog duplicate gate found the existing focused-package-test filter entry;
  no new repository friction was logged.
- The state-consistency audit verified both corrected findings and found no
  unresolved inconsistency.
Completed: 2026-08-24
Completed: 2026-08-24
