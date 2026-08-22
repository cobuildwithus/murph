---
title: 'browser training week-bucket test depends on the current Monday'
severity: 'minor'
---

## Friction

`apps/web/test/browser-training-view.test.ts` asserted fixed August 2026 week buckets without passing the selector's supported `now` and `timeZone` inputs. The test passed before the next Monday boundary, then failed unchanged on both a PR head and its parent branch when the wall clock reached 2026-08-17. This red-gated the full release-app shard after more than ten thousand tests had passed.

## Workaround

Reproduce the single file on both the candidate and parent, then bind the scenario to its fixed date through the public selector options.

## Desired behavior

Fixed-date calendar tests should always supply an explicit clock and time zone so CI results do not depend on the execution date.
