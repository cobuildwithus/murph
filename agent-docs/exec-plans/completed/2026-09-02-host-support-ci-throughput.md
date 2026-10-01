# Reduce Host Support CI critical-path time

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Reduce the wall-clock time of the required Ubuntu Host Support app-verification and package-coverage checks without dropping tests, weakening coverage thresholds, or recreating the resource deadlock already tracked by Frog issue #2656.

## Success criteria

- The app and package owners exercised by the current Host Support workflow remain complete and fail closed.
- The workflow no longer serializes independent heavy owners when runner isolation or bounded worker budgets make safe overlap possible.
- Focused workflow-policy tests lock the new job graph, package assignment, resource bounds, and final aggregator behavior.
- The testing and verification owner docs describe the new execution shape.
- ReviewGPT returns a scoped patch proposal based on the exact current workflow and measured Actions evidence; the parent validates and adapts it before landing.

## Evidence and root cause

- Ten recent completed Host Support runs show successful critical paths of about 11-13 minutes for CLI coverage, 17-21 minutes for assistant/platform coverage, and 21-28 minutes for app verification.
- One representative successful run spent about 18.5 minutes in Web verification and another 4.3 minutes in Cloudflare verification because the two app owners are intentionally serial in one job.
- The package matrix contains only three jobs, but each job loops its assigned packages serially. The assistant shard is dominated by Assistant Engine, while the platform shard serially accumulates Assistant Runtime, Core, Device Sync, Query, Vault Usecases, and many small packages.
- The prior forced same-runner Web/Cloudflare overlap caused memory contention and indefinite Cloudflare stalls. Any new overlap must use runner isolation or retain serial resource ownership within a runner.

## Scope

- In scope: `.github/workflows/host-support.yml`, its focused workflow-policy tests, release-verification planning only if required, and the two durable verification/CI owner docs.
- Out of scope: changing product tests, reducing coverage requirements, weakening the final `Release checks (ubuntu)` aggregator, changing unrelated PR branches, or modifying production runtime behavior.

## Architecture and constraints

- Keep GitHub Actions as the existing execution owner and the final aggregator as the single required-check owner.
- Prefer job-graph changes and existing package/app commands over a new scheduler or cache layer.
- Preserve exact-merge-candidate checkout behavior, frozen installs, generated-input preparation, PostgreSQL-backed Web coverage, and existing per-owner worker limits unless direct evidence supports a bounded adjustment.
- Do not reintroduce same-runner Web/Cloudflare overlap; separate jobs are the safe overlap boundary.
- Treat ReviewGPT's patch as behavioral intent and accept only changes proven by current source and focused tests.

## Tasks

1. Capture current workflow/job durations and per-owner timing evidence from successful Actions runs.
2. Ask ReviewGPT for a scoped patch that shortens the critical path while preserving coverage and fail-closed aggregation.
3. Inspect the returned patch against workflow ownership, resource bounds, package completeness, and repository simplicity rules.
4. Apply the smallest validated design and add focused workflow-policy coverage.
5. Run focused local verification, review the final diff, commit and open a draft PR, then complete required exact-head gates.

## Verification plan

- `node --test scripts/pull-request-ci-policy.test.mjs`
- Focused release-plan or workspace-verifier tests for any changed helper.
- `pnpm complexity:diff`
- `git diff --check`
- Exact-head Host Support GitHub Actions, with measured comparison against the recent 11-28 minute baseline.

Completed: 2026-09-02
