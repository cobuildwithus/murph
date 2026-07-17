# PR 752 ReviewGPT round 4 remediation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Preserve supported edits and explicit type clears for WHOOP sleeps whose
  first provider revision already contains `sleepType`, without weakening the
  narrow legacy enrichment exception.

## Success criteria

- Provider-baseline resolution prefers an exact historical match for the full
  incoming typed sleep.
- The resolver falls back to incoming content without `sleepType` only when no
  exact typed provider history exists.
- Ordinary source-preserving edits and explicit type clears remain latest for
  initially typed sleeps while unrelated mixed-snapshot resources commit.
- Exact replay is byte-stable and same-version provider changes beyond
  `sleepType` remain atomic conflicts.
- Focused tests, owner coverage, exact-head CI, and ReviewGPT round 5 pass.

## Scope

- In scope: the existing WHOOP historical content-fingerprint lookup,
  production-faithful real-vault regressions, required verification, PR
  metadata, CI, and ReviewGPT round 5.
- Out of scope: new provenance state, migrations, source-semantics changes,
  broad device-conflict policy, deployment, and merging PR 752.

## Constraints

- Reuse `deviceOwnerRevisionsByRefKeyAndFingerprint`; add no state owner or
  compatibility machinery.
- Exact full-content history takes precedence over the legacy stripped-content
  fallback.
- Compare against the earliest exact matching revision so a later supported
  edit that returns to provider-shaped content is not treated as authorship.

## Tasks

1. Reproduce both initially typed failure paths through `editEventRecord`.
2. Resolve exact typed history before the legacy no-type fallback.
3. Run focused, coverage, scenario, privacy, and parent final-review gates.
4. Commit, push, update PR metadata, and run ReviewGPT round 5 with CI.

## Decisions

- Keep one resolver and one existing index. An exact full-content match proves
  the baseline for steady-state typed records; stripped content proves only the
  one-time legacy enrichment when no typed match exists.

## Verification

- Before the correction, an initially typed WHOOP sleep with an ordinary
  source-preserving edit failed the same-version mixed snapshot with
  `EVENT_SOURCE_REVISION_CONFLICT`.
- Before the correction, an initially typed WHOOP sleep with an explicit type
  clear was overwritten by a new revision 3 on same-version replay.
- After the correction, the real-vault file passes all three legacy and typed
  histories; both typed cases commit an unrelated recovery row and replay
  byte-stably. The ordinary edit remains revision 2 with `main_sleep`, while
  the explicit clear remains revision 2 without it.
- Focused core validation keeps both legacy enrichment and atomic rejection of
  a same-version provider change beyond `sleepType` passing.
- The independent coverage-write pass made no edits and found the proof
  sufficient. Exact diff-aware verification passed in 525 seconds across 18
  affected owners, including core 725 tests, vault-usecases 204, CLI 1,086,
  assistant-engine 2,420, assistant-runtime 1,723, web 5,379 plus lint/build/
  dev-smoke, and Cloudflare 1,832.
- Pending final scoped commit, exact-head CI, and ReviewGPT round 5.
Completed: 2026-07-16
