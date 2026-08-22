# Restore PR review disclosures round-2 retrospective

Status: completed
Created: 2026-08-19
Updated: 2026-08-19

## Goal

- Resolve the ReviewGPT round-2 retrospective and the exact-head CLI coverage
  failure without adding another design-proof owner or weakening the restored
  evidence requirement.

## Decision

- CI owns the mechanically truthful boundary: a rendered Design proof section
  with a supported absolute HTTP(S) link and fragment plus concrete Evidence and
  Coverage.
- The preliminary frontend ReviewGPT lens owns repository origin, reachability,
  currentness, and whether the destination represents the changed state.
- Do not add a hostname regex, network crawler, route/anchor registry, manifest,
  or preview lifecycle owner.
- Remove the one-off route test that duplicated the semantic review boundary.

## Tasks

1. [x] Record the requirement-level retrospective on PR #2020.
2. [x] Align the validator, workflow name, template, and durable docs with the
   structural-CI/semantic-review boundary.
3. [x] Update the stale CLI regression assertion to require the restored five-row
   added/deleted LOC breakdown.
4. [x] Run focused proof and prepare one combined correction for the immutable
   final ReviewGPT loop.

## Constraints

- Preserve the first-reviewed head.
- Keep dedicated design proof and CI enforcement.
- Keep screenshots risk-based and preserve the existing non-UI exemptions.

## Verification

- The requirement-level retrospective and explicit continuation decision are
  recorded on PR #2020.
- `node --test scripts/check-frontend-design-proof.test.mjs scripts/check-pr-architecture-summary.test.mjs scripts/check-pr-changelog.test.mjs scripts/check-pr-deployment-concerns.test.mjs` — 32 passed.
- `pnpm test:frontend-design-proof` — 7 passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts -t "exposes only the package-backed review-gpt runner"` — 1 passed, 45 skipped.
- `pnpm docs:drift` and `git diff --check` — passed.
- The round-2 correction deletes one more line than it adds and removes the
  duplicate route-test owner.
Completed: 2026-08-19
