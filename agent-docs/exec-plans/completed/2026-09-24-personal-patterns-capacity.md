# Personal Patterns capacity recovery

Status: completed
Created: 2026-09-24

## Outcome and invariant

Daily Personal Patterns can recover from a prolonged provider-capacity shortage
using the existing Flex retry owner. Ordinary reminders retain their one-hour
freshness limit. Canonical occurrence identity, authority, delivery deduplication,
foreground priority and retry backoff remain controlling.

## Evidence and design

The existing retry policy retains Flex for managed Personal Patterns, while the
canonical deliverability owner applies the generic one-hour expiry. A synthetic
capacity failure followed by recovery 150 minutes later reproduces the gap.
Give only the immutable managed Personal Patterns daily schedule a four-hour
freshness window. Move its existing identity constant to a leaf module to keep
imports acyclic; re-export it at the existing entrypoint. No new state, migration,
queue, dependency, model fallback or scheduler is needed.

## Scope and proof

- Prove delayed recovery through the existing cron runtime test on Flex.
- Prove the four-hour boundary, ordinary/custom schedule expiry and active-window
  authority through focused deterministic tests.
- Run assistant-engine typecheck, focused tests, diff and complexity review.
- Update the architecture owner and member-facing changelog.
- Commit scoped changes. Deployment and re-running expired production occurrences
  are separate production actions; no production mutation is part of this patch.

## Product UX

Patch: daily Personal Patterns may arrive later after a capacity shortage, up to
four hours after its due time. No duplicate replay of consumed occurrences.
Ordinary and one-shot reminders retain their current freshness behavior.
Deterministic time/admission proof owns this change; prompts, tools and model
reply policy do not change.

## Verification

- Baseline: the delayed Personal Patterns retry fails against the original
  canonical deliverability implementation (five other managed retry cases pass).
- Fixed: 13 focused freshness/runtime checks pass, covering Flex recovery at
  150 minutes, the inclusive four-hour boundary and expiry immediately after,
  renamed versus spoofed identity, custom/one-shot schedules, ordinary expiry,
  onboarding expiry and active-until retirement across DST.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed.
- Complexity guard: passed, no added debt; existing managed-automation hotspots
  are unaffected by the constant move. Changelog generation and diff check pass.
- Product UX: Ready for the scoped deterministic recovery behavior. No model or
  prompt change; no live model proof is needed for clock arithmetic/admission.
- One initial test command forwarded an extra separator and selected the broad
  suite. It was interrupted using its proven session-owned process. The corrected
  focused command above is the relevant proof; broad-suite success is not claimed.
- Parent review: no new persistent state, external calls, dependencies, foreground
  work, or production mutation. The identity leaf preserves existing exports and
  avoids a new import cycle.
- Deployment, exact-head CI and eligible PR ReviewGPT remain pending a PR/release.
  The expired production occurrences are not revived by this code change.
Updated: 2026-09-24
Completed: 2026-09-24
