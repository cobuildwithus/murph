# Exercise Library Follow-Up

## Goal

Land the additional exercise seed data and review fixes on PR 56.

## Scope

- Add the second exercise/stretch seed CSV without storing local download paths.
- Make exercise generated artifacts deterministic on clean checkouts.
- Wire the new package into root verification and coverage.
- Preserve source provenance in compact catalog artifacts.
- Fix small exercise CLI semantics/facets/docs issues.
- Fix assistant response media cleanup/list command review items.

## Non-Goals

- Do not broaden exercise schema beyond current catalog needs.
- Do not split PR branches.
- Do not restore unrelated stashed work into this commit.

## Verification

- Exercise package verify.
- CLI package-shape and focused CLI tests.
- Root typecheck.
- Targeted assistant media tests where available.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
