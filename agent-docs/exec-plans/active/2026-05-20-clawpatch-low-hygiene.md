# Clawpatch Low Hygiene

## Goal

Close the remaining low-severity Clawpatch hygiene findings without broad package reshaping:

- Revalidate the already-fixed `apps/web` findings.
- Tighten package-boundary tests so they exercise public/package contracts rather than brittle source text or manifest-key checks.
- Remove small build/test coupling issues where package scripts depend on undeclared tools or unnecessary project references.
- Keep fixes simple, maintainable, and aligned with existing package ownership boundaries.

## Scope

- `packages/assistant-runtime`
- `packages/contracts`
- `packages/core`
- `packages/device-syncd`
- `packages/health-commons`
- `packages/health-metrics`
- `packages/openclaw-plugin`
- `packages/runtime-state`
- `packages/setup-cli`
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `scripts/verify-dependency-policy.mjs` only for narrow transitive dependency-audit and Axios-compromise guard fixes surfaced by required verification
- `.clawpatch` revalidation/status only for already-fixed `apps/web` findings

## Constraints

- Do not create new package ownership surfaces or compatibility shims.
- Do not reach into sibling package internals; preserve package-name/public-entrypoint imports.
- Keep package dependency changes minimal and justified by existing script contracts.
- Do not expose secrets, local paths, account usernames, or direct personal identifiers in logs, docs, or generated files.
- Preserve unrelated active work and existing ledger rows.

## Verification Plan

- Run focused package tests/typechecks for touched packages.
- Prefer `bash scripts/workspace-verify.sh test:diff <touched paths>` for the final scoped lane.
- Revalidate or report Clawpatch state for fixed findings.
- Run required completion audits before closing the plan.

## Status

- Active. Subagents will work on disjoint package slices; parent will integrate, verify, audit, and commit.
