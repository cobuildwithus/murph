---
title: 'Release audit tests depend on retired specialist prompt files'
severity: 'minor'
---

## Expected Behavior

Completion-pass retirement should preserve executable audit-bundle coverage without requiring obsolete prose or removed prompt files.

## Current Behavior

The release-script audit suite reads the retired frontend-review prompt to assert narrative wording and requires the retired coverage-review prompt in a full bundle. Both tests fail after removing the specialist workflow.

## Possible Solution

Delete the narrative-only test and use the retained seam-audit guidance to prove lean/full bundle inclusion. Remove obsolete specialist fixtures from the synthetic packaging harness.

## Minimal Reproducible Example

Remove the specialist prompt files and run the release-script-coverage-audit test file. The Product UX prose assertion and full-bundle inclusion assertion fail.

## Context

Found during the direct-push acceptance check for specialist-pass retirement. The correction preserves bundle inclusion/exclusion proof without freezing workflow prose.
