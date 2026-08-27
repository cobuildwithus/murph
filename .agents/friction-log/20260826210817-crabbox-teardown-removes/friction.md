---
title: 'Crabbox teardown removes delegated failure evidence needed for release triage'
severity: 'major'
---

## Friction

Two paid release-acceptance runs returned only package-owner labels after the one-shot Testbox was removed. The delegated Vitest failure bundle was no longer retrievable, so exact failing tests could not be inspected.

## Impact

Release diagnosis required reconstructing the contention pattern from isolated CI shards and local reproductions instead of using the failed run artifact. This consumed a second paid retry and delayed a public package release.

## Workaround

Compare exact-tree isolated CI results with the reported package owners, then reproduce those owners locally under bounded concurrency.

## Suggested improvement

Persist the delegated failure bundle before Testbox teardown and print a stable artifact location in the dispatcher result. Keep the package-owner summary, but also retain the exact failing test names and stderr for the completion owner.
