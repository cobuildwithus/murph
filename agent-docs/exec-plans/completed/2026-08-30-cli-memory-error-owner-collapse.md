# Reuse the canonical memory parse-error owner in onboarding resume

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Preserve the terminal onboarding memory-repair UX while deleting the local
  structural reimplementation of the contracts-owned parse error.

## Product UX

- Outcome: duplicate canonical memory remains a terminal, actionable onboarding
  recovery with the same privacy-safe file, line, and field hint.
- Reaches: only the internal recognition path for the existing canonical parse
  error changes; unrelated failures keep the generic surface.
- Proof: focused built onboarding and memory CLI regressions exercise the exact
  query-to-contracts error path and unchanged user-visible result.

## Constraints

- Import through the contracts package public entrypoint and declare the direct
  workspace dependency plus matching lockfile and TypeScript reference.
- Use class identity and exact canonical path equality; trust only the details
  already sanitized by the contracts-owned constructor.
- Add no compatibility decoder, duplicate validator, retry, mutation, or state.

## Tasks

1. [x] Replace the local structural decoder with contracts-owned identity.
2. [x] Update the workspace manifest, project reference, and lockfile.
3. [x] Run focused regressions, affected typechecks, and dependency checks.
4. [x] Inspect privacy and scope and prepare the exact-head PR update.

## Verification

- Focused assistant onboarding built-runtime regression.
- Focused built memory CLI regression.
- Assistant CLI and Murph typechecks.
- `pnpm deps:guard`, `pnpm deps:audit`, and ignored-build review.
- `git diff --check` and private-identifier scan.

## Results

- The verified in-process path is assistant CLI to the integrated vault query,
  then the query memory reader to the contracts parser; the thrown class is the
  same contracts package instance now imported directly by assistant CLI.
- Assistant CLI command coverage passed 19 of 19 tests, and assistant CLI and
  Murph typechecks passed.
- The explicit assistant CLI build and focused built onboarding regression
  passed with the unchanged terminal safe surface; the focused built memory
  regression also passed and kept the document byte-identical.
- CLI package-shape verification passed, including the bundled internal
  dependency graph.
- Dependency policy verification passed and the ignored-build list was
  reviewed without adding an exception. The high-severity audit remains red on
  79 pre-existing advisories in unrelated dependency paths; this change adds
  only a workspace link and no package version or external dependency.
- Product UX verdict: Ready. The visible recovery contract is unchanged while
  42 lines of duplicate structural recognition and validation are deleted.
Completed: 2026-08-30
