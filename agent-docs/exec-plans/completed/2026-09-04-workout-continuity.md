# Recover workout context from saved reminders

Status: completed

## Outcome and root cause

A standalone workout reminder can have a saved exercise/set definition but no
canonical workout event or format reference. A terse completion then reaches the
missing-identity fallback. The hosted automation inspection response omitted
stored title and instructions in both the runtime projection and provider
serializer, preventing recovery through the exact reminder identity.

Private operational evidence stays outside this repository. The synthetic proof
uses a different exercise, routine, dates, and set sequence. Existing exact-event
continuity remains owned by the established workout-context path.

## Implementation

Expose the existing definition on read-only automation inspection. Teach the
existing workout skills to inspect the exact host-preserved reminder before
clarifying. A complete standalone definition plus explicit member completion
allows one ad-hoc start and only the reported set write. Regimen/experiment and
saved-format ownership retain their existing paths. Missing or ambiguous context,
conflicts, and explicit clears remain no-write paths. Do not patch reminders,
select older workouts by recency, or invent earlier completions.

The live replay also exposed an adjacent classification bug: help output could
be treated as a failed workout result and clear the subsequent canonical event.
Ignore help/schema inspection commands when deriving workout delivery context;
retain existing failure, conflict, and deletion behavior. Deterministic help
regressions failed before this fix. Inspection output remains bounded while
allowing the full existing instruction field limit, including JSON escaping.

No new state, selector, dependency, migration, retry, or scheduling mechanism.
Optional inspection fields preserve older adapters; no pre-provider work changes.

## Evidence

- Deterministic runtime projection and provider serialization regressions each
  failed before the corresponding fix; focused assertions pass afterward.
- Real-Codex replay reproduced the missing-workout clarification when the
  provider serializer still omitted the definition.
- Final hosted-tool replay and terse follow-up passed on the final behavior:
  one exact reminder inspection, one start, two set writes on the same event,
  earlier set pending, older event and reminder unchanged, no identity question.
  Actual two-turn replies were reviewed. Help reads are not counted as writes.
- Focused engine regressions passed (36 tests); runtime inspection/authority/route
  regressions passed (3 tests).
- Both affected package typechecks passed; final fixture and tracker typecheck passed.
- Complexity guard passed with unchanged debt and unchanged source hotspots.
- Changelog archive validation passed (9 tests). Parent candidate review passed: no extra owner, no authority expansion, bounded
  definition output, unchanged actual-failure handling, synthetic-only evidence.

## Product UX and release

Patch; Ready after direct proof. Private workout replies recover an unambiguous
saved definition and then continue the exact created event. Unreported sets and
older records remain untouched. No member transcript or production identifiers
are included in the fixture or changelog.

ReviewGPT round 1 passed on cf53ada0e9e90b0fc087be8f80059e8ba23f9f42
with no findings. Explicit gpt-6-pro selection and response metadata matched;
the full-snapshot review exceeded ten minutes and independently checked 35
boundary cases. The first stale-model-alias attempt was recovered, rejected as
a gate result, and not used for approval. The repository integration friction
is recorded separately. Parent disposition accepts the final PASS, with local
reply/card and archive-copy review supplying presentation evidence.

Only this completed plan and the public-safe friction record change after the
reviewed behavior. Required CI on the final PR head and production rollout are
remaining release gates tracked by PR #2837, not claimed complete here.
Deploy through the protected private hosted workflow. Verify the immutable public release, bundle,
live-model smoke, and managed-container convergence. No production member record
mutation is part of diagnosis or validation. Archive through scripts/finish-task after the candidate and review disposition.
Updated: 2026-09-04
Completed: 2026-09-04
