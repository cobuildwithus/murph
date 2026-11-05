# Remove retired feature remnants

Status: completed
Created: 2026-11-05
Updated: 2026-11-05

## Goal

Remove the remaining repository material for the retired age-scoring feature,
including dedicated historical records, obsolete test assertions, configuration
exclusions, and the old public retirement entry, as explicitly requested.

## Scope and decisions

- Runtime calculators, APIs, CLI commands and routes were already removed.
- Delete dedicated records; omit feature details from mixed historical records
  while retaining unrelated outcomes and failed-verification evidence. This
  explicit removal request supersedes normal historical-record immutability.
- Preserve ordinary demographic ages, shared health metrics, and comparisons
  describing other products. No saved member data or Git history is changed.
- Remove the ignored research-script directory in the original checkout.
- Remove the existing retirement changelog fragment; no replacement announcement
  is appropriate for repository residue cleanup. Use existing archive proof.
- No runtime owner, persistence, provider input, or deployment protocol changes.
  Final external review is not required for docs, static content and low-risk
  testing/configuration cleanup. Parent review owns this removal.

## Tasks

1. Inventory feature names, paths, CLI commands, ignored scripts and references.
2. Remove dedicated material and clean mixed references and index links.
3. Run focused CLI, sidebar, changelog and tooling proof and relevant typechecks.
4. Review the complete diff and privacy, close this plan and commit the scope.

## Verification

- Passed CLI schema/discovery suite: 8 tests.
- Passed sidebar and changelog archive suites: 27 tests.
- Passed tooling suites using the cleaned Vitest configuration: 8 tests.
- Passed CLI and Web package typechecks and `tsconfig.tools.json` typecheck.
- Passed changelog generation, complexity diff, docs drift, docs gardening
  (zero issues), and whitespace checks.
- Reference scan found no remaining named feature references or links to deleted
  files. Broader biological-age matches describe other products and remain.
- Removed 138 dedicated tracked files and 555 ignored research-script files.
- Parent review: Ready. Runtime behavior is unchanged; only the obsolete public
  retirement entry disappears. Existing archive rendering proof passed.
- No new repository friction. No push, merge, deployment or history rewrite.
Completed: 2026-11-05
