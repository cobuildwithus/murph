# Release Trusted Publishing Investigation

## Goal

Find the concrete reason the tag-driven npm release is failing, compare it against the known-good sibling repo, and land the smallest durable fix so the Murph release workflow can publish successfully through the intended trusted-publishing path.

## Why This Needs A Plan

- The failure is on a production release surface.
- The likely fix spans CI workflow logic, package metadata, and possibly npm package/bootstrap assumptions.
- The repo policy treats release/configuration changes as high-risk and requires explicit proof plus a scoped commit path.

## Guardrails

- Preserve unrelated worktree edits if the tree becomes dirty during investigation.
- Do not reintroduce token-based publishing unless the root cause proves trusted publishing itself is impossible for this package set.
- Treat the release log evidence and working sibling repo as the primary comparison points before changing behavior.

## Expected Evidence

- GitHub Actions run/job logs for the failing release.
- Current Murph workflow plus publish helper/package metadata.
- Working sibling repo release workflow one directory up.
- Registry/package state for the failing package names under the npm scope.

## Exit Criteria

- Root cause is stated concretely, not guessed.
- Any code/workflow change is minimal and aligned with the proven failure mode.
- Required verification passes locally.
- The task ends with a scoped commit and a clean ledger state.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
