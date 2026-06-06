# Remove vestigial continuity files

Status: completed
Created: 2026-06-06
Updated: 2026-06-06

## Goal

- Remove stale root-level continuity ledgers and any other clearly vestigial root
  artifacts that are no longer referenced by live repo docs or workflow.

## Success criteria

- The user-named stale continuity files are deleted when present.
- Additional deletions are limited to files with clear stale/vestigial evidence.
- Removed files have no live references outside Git history.
- Markdown-only cleanup verification passes through direct readback/reference checks.

## Scope

- In scope: root-level `CONTINUITY_*.md` files and obviously stale root-level
  task residue with no live references.
- Out of scope: canonical docs, active/completed execution plans, generated
  artifacts managed by existing ignore/build rules, and speculative cleanup.

## Constraints

- Technical constraints: preserve unrelated working-tree edits; do not delete a
  file unless stale status is directly supported by references/history/context.
- Product/process constraints: keep the cleanup small and avoid adding new
  process surface while removing old one-off artifacts.

## Risks and mitigations

1. Risk:
   Mitigation: check references before deletion and keep the deletion set narrow.

## Tasks

1. Inspect the named continuity files and nearby root-level residue.
2. Delete only confirmed stale files.
3. Check for broken references and read back the resulting diff.
4. Close the execution plan through the repo commit helper.

## Decisions

- Delete the five user-named root `CONTINUITY_*.md` files.
- Also delete `missing-authors-journals.csv` and `vault-size-breakdown.json`
  because they are root-level one-off analysis artifacts with no live
  references.
- Leave `TODOS.md`, `migration.md`, and `CLAUDE.md` in place because current
  code/docs still reference or intentionally use them.

## Verification

- Commands to run: `rg` reference checks, direct file-existence checks, and
  `git diff --check`.
- Expected outcomes: no live references to removed files, named files absent,
  and no whitespace/diff hygiene failures.
- Passed:
  - `find . -maxdepth 2 -type f -name 'CONTINUITY_*.md' -print | sort`
    returned no files.
  - `rg` for removed file names found only the active cleanup plan and
    historical completed-plan references.
  - `git diff --check`
  - `pnpm typecheck`
  - `pnpm test`
Completed: 2026-06-06
