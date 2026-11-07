---
title: 'Repository tooling fixture calls live GitHub Markdown rendering'
severity: 'minor'
---

## Expected Behavior

The repository tooling fixture suite should validate changelog and PR-body behavior with deterministic local responses, independent of GitHub Markdown API availability or network policy.

## Current Behavior

The `frog-workflow-guards.test.ts` fixture invokes `check-pr-changelog`, which reaches live GitHub Markdown rendering. An HTTP 403 makes the tooling lane fail even when the application build and typechecks pass. The observed run had 743 tooling tests pass, one fail, and two skip; the failing case was unrelated to the phone cleanup diff.

## Possible Solution

Use the existing `MURPH_GITHUB_MARKDOWN_URL` seam with a deterministic local HTTP server in this fixture. Keep the production renderer and its authorization behavior unchanged, and add an explicit fixture assertion that no live GitHub request is needed.

## Minimal Reproducible Example

Run the repository tooling test lane with the `frog-workflow-guards.test.ts` fixture in an environment where GitHub Markdown rendering responds with HTTP 403. The fixture should prove the intended guard behavior locally, but instead fails while rendering its synthetic PR body through the live endpoint.

## Context

This external dependency blocked an otherwise successful cleanup PR verification lane. The report contains only repository/tooling facts; retrying CI remains a temporary recovery, not a deterministic fixture fix.
