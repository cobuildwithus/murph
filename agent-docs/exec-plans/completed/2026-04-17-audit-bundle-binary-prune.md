# Prune large web binaries from default audit bundle

Status: completed
Created: 2026-04-17
Updated: 2026-04-18

## Goal

- Keep repo audit bundles focused on review-relevant source and docs by excluding large committed web and doc binaries that materially inflate zip size without improving code review context.

## Success criteria

- The default audit bundle excludes the large committed raster/PDF assets currently dominating zip size.
- The full audit bundle still includes tests, docs, and CI files while also excluding the same large binary assets.
- Coverage tests document the new exclusion behavior.

## Scope

- In scope:
- `scripts/repo-tools.config.sh`
- `scripts/package-audit-context-full.sh`
- `packages/cli/test/release-script-coverage-audit.test.ts`
- Out of scope:
- npm publish tarball contents
- changes to app assets themselves

## Constraints

- Technical constraints:
- Preserve current audit-bundle coverage of source, tests, docs, and CI where intended.
- Product/process constraints:
- Avoid touching unrelated in-flight hosted web and Cloudflare work.

## Risks and mitigations

1. Risk: Excluding too broadly could remove files that reviewers actually need.
   Mitigation: Limit the change to obvious large binary assets under `public/` and `docs/assets/`, and keep tests/docs/CI inclusion behavior unchanged.

## Tasks

1. Add a shared binary-exclude list to the audit bundle config.
2. Make the full audit wrapper retain those binary excludes while still widening tests/docs/CI coverage.
3. Update the release coverage audit test to prove the exclusions.

## Decisions

- Exclude large committed raster/PDF assets from both audit bundle variants, but keep all current source/test/doc/CI scan coverage behavior.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash -n scripts/repo-tools.config.sh scripts/package-audit-context-full.sh`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts`
- `pnpm verify:acceptance`
- Expected outcomes:
- Tooling and tests stay green, and the audit-bundle test proves the large binary assets are absent from both zip variants.
- Outcomes:
- `pnpm typecheck` passed.
- `bash -n scripts/repo-tools.config.sh scripts/package-audit-context-full.sh` passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts` passed (`21` tests).
- `pnpm verify:acceptance` passed, including repo package coverage plus `apps/web verify` and `apps/cloudflare verify`.
Completed: 2026-04-18
