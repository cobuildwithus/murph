# PR 752 ReviewGPT round 3 remediation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Preserve ordinary user edits when WHOOP backfills `sleepType` at the same
  source version, while still enriching untouched legacy sleeps and rejecting
  unrelated same-version provider changes.

## Success criteria

- Provider-baseline recognition uses historical canonical device content, not
  the latest revision's persisted `source` value.
- An edit made through the supported event mutation path without changing
  `source` remains current while an untouched sibling is enriched.
- Recovery rows in the same snapshot commit and replay remains byte-stable.
- The public CLI edit path proves that omitting `--source` preserves
  `source=device`.
- Focused tests, typechecks, exact-head CI, and ReviewGPT round 4 pass.

## Scope

- In scope: the narrow WHOOP same-version sleep-type guard, real-vault and CLI
  regressions, required verification, PR metadata, CI, and ReviewGPT round 4.
- Out of scope: broad provider conflict-policy changes, new persisted state,
  deployment, and merging PR 752.

## Constraints

- Reuse `deviceOwnerRevisionsByRefKeyAndFingerprint`; do not infer provider
  authorship from the mutable latest revision's `source` field.
- Keep the equal-version exception limited to WHOOP sleep rows whose incoming
  content without `sleepType` exactly matches historical canonical content.
- Preserve the existing mixed provider-side change rejection.

## Tasks

1. Make the real-vault regression production-faithful and prove the failure.
2. Resolve the historical provider baseline from the existing content index.
3. Add public CLI source-preservation proof and run focused verification.
4. Commit, push, update PR metadata, and run ReviewGPT round 4 with CI.

## Decisions

- Compare the current canonical revision with the earliest historical revision
  whose content fingerprint matches the incoming row after removing only
  `sleepType`. Exact provider replays do not append revisions, while a later
  supported edit can retain `source=device` and even return to the original
  content after explicitly clearing `sleepType`. This recognizes the precise
  provider baseline without adding a second index or broadening source-version
  semantics.

## Verification

- Before the core correction, the production-faithful real-vault regression
  failed with `EVENT_SOURCE_REVISION_CONFLICT` after a supported edit retained
  `source=device`.
- Focused core validation passed both legacy mixed-snapshot enrichment and the
  atomic rejection for a same-version provider change beyond `sleepType`.
- The public `event edit` CLI path passed without `--source` and preserved
  `source=device`.
- The independent coverage-write pass added explicit-clear proof for the
  earliest-baseline rule; the focused real-vault file passed 2/2 and the
  vault-usecases coverage lane passed 30 files / 203 tests.
- Exact diff-aware verification passed in 625 seconds across 18 affected
  package owners, 5,379 web tests plus lint/build/dev-smoke, and 1,832
  Cloudflare tests.
- Pending final scoped commit, exact-head CI, and ReviewGPT round 4.
Completed: 2026-07-16
