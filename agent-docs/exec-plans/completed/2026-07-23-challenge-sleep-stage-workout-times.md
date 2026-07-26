# Challenge scopes: deep/REM sleep days and latest workout start

Status: completed
Created: 2026-07-23
Worktree: `/private/tmp/murph-sleep-stage-workout-times` (`agent/challenge-sleep-stage-workout-times`)

## Outcome

A group challenge can score, per consenting member through
`murph.group action="read_shared"`:

1. Deep sleep minutes per night, and REM minutes per night.
2. Whether any workout started after a configured local time of day.

## Invariant

Vault Share stays a closed registry of deterministic fixed-schema projection
kinds; adding a kind adds a data schema and a projector, never widening the
envelope or adding a state owner. Consent stays exact-scope: each new fact is
its own explicit grant (deep sleep, REM, workout timing are three scopes;
existing total-sleep or workout-count grants must not widen). Deploy skew
stays safe through the existing `supportedProjectionScope` capability
negotiation; the frozen legacy fallback list must not gain the new kinds.

## Design (ReviewGPT-consulted; extend current owners at their seams)

1. Two new daily-metric kinds for deep and REM sleep minutes via the existing
   `HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS` table
   (`metricKey: deep-sleep-minutes` / `rem-sleep-minutes`, 0–1440) plus the
   selectable-kind list; generic parser/projector need no new code. Add a
   registry-parity test (kind/spec uniqueness, generic dispatch reachability,
   explicit bounds).
2. One new date-keyed fixed kind publishing the latest local workout start
   time per day (per-session records rejected: the 7-record delivery cap
   could silently truncate and produce false negatives):
   - strict parser in `packages/hosted-execution/src/vault-share.ts`: local
     date, start minute-of-day integer 0–1439, required v0 time-semantics
     marker, no extra keys; UTC-midnight envelope timestamp only.
   - reader in
     `packages/assistant-runtime/src/hosted-runtime/vault-share-projection.ts`
     over the cached activity-session rows with a shared nested-workout
     extraction helper (`fields.workout.startedAt` → legacy flat `startAt` →
     `occurredAt`), timezone = canonical event timezone else validated vault
     timezone (omit event when neither validates), `activity_session`-only
     (no `intervention_session`), dedupe before max, per-day maximum,
     7-day window, fail-closed empty on the 500-row source cap.
   - missing day = unobserved (never "no workout"); zero/early values stay
     available data; the challenge skill normalizes the human threshold once
     and uses strict greater-than comparison.
3. Web: consent labels/disclosure copy for the three scopes (join policy +
   selectable scopes); timing copy states intra-day timing is shared and what
   is not shared (no end time, sport, provider, absolute timestamps).
4. Skill guidance: add scopes to `group-challenge/SKILL.md` fact catalog with
   threshold normalization, strict comparison, missing-not-false, current-day
   provisional handling; model permission explanation gains the three scopes.
5. Tests beside each touched owner (parser round-trip/rejection, reader
   dedupe/boundary/timezone cases, web shared-read matrix, capability
   negotiation, skill enumeration, regression for existing workout/activity
   selectors sharing the row mapper).

## Non-obvious surfaces

- `murph.group` tool schema enums derive from hosted-execution constants; the
  contract fingerprint rotates provider threads on first post-deploy turn
  (bounded committed-transcript replay). Disclose in PR body; proof =
  `assistant-codex-turn-planning.test.ts`.
- Shared row-mapper change (nested workout extraction) touches existing
  `workout-days.v0`/activity selectors; regression coverage required.
- `LEGACY_OMITTED_CAPABILITY_FIXED_PROJECTION_KINDS` stays frozen.

## Verification

`pnpm test:diff packages/hosted-execution packages/assistant-runtime
packages/assistant-engine apps/web` (or owner coverage commands per the
verification doc) plus the focused new-kind tests above.

## Deployment

Web first (parse/store/return + consent copy; old runners filtered out
safely), then Cloudflare runner with `container_rollout=immediate`; after
convergence offer the new permissions and refresh consenting members'
replacement snapshots via the existing bounded maintenance wake. No backfill
queue or new state owner.
Updated: 2026-07-24
Completed: 2026-07-24
