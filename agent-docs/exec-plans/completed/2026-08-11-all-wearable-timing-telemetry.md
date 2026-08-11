# Attribute wearable timing telemetry across all supported sources

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Make the existing privacy-limited wearable import timing event attributable
  to the actual supported wearable source when Murph knows it, including
  Garmin, Fitbit, and every other Junction source, while preserving the
  connector owner (`junction`, `oura`, `whoop`, or `strava`) separately.
- Keep canonical import, retry, and pull-floor behavior unchanged. This is an
  operational observability improvement with no member-facing UX change.

## Success criteria

- `device-sync.import_completed` records a bounded `sourceProvider` alongside
  the existing connector `provider`; direct integrations use their connector
  as the source fallback and Junction imports use the existing source slug.
- A verified webhook-level source is retained for lifecycle/reconcile timing
  when no individual job payload carries a source.
- Coalesced jobs never claim a single source when their timing evidence names
  different sources.
- Tests prove Garmin and Fitbit attribution, direct-provider fallback,
  mixed-source coalescing, timing preservation, and content-free logs.
- Focused tests, affected TypeScript checks, exact-head CI, preliminary
  coverage review, and the final sensitive ReviewGPT gate pass.

## Scope

- In scope:
  - Thread the already-normalized source slug through the existing dirty
    resource and pass-local timing carrier.
  - Add one sanitized operational field to the existing buffered runtime log.
  - Update the canonical device-sync and runtime-log documentation.
  - Add focused Web and assistant-runtime regression coverage.
- Out of scope:
  - New webhook parsers, provider SDKs, polling schedules, import jobs, tables,
    queues, replay ledgers, dashboards, or health-data fields.
  - Turning best-effort pass-local telemetry into an exhaustive import ledger.
  - Raw timestamps, resource/event semantics, device/member identifiers,
    health values, counts, or webhook bodies.

## Constraints

- Technical constraints:
  - `provider` remains the runtime connector owner; `sourceProvider` is
    attribution only and must not change executor routing or canonical writes.
  - Source attribution is exact only when all evidence coalesced for one job
    agrees; otherwise it is omitted rather than mislabeled.
  - Logging remains buffered, best-effort, bounded, and outside the foreground
    reply critical path.
  - Existing dirty-resource state is the only carrier; no new persisted owner.
- Product/process constraints:
  - Preserve device-sync ingestion invariants, health-data privacy, and
    additive Web/runner deployment compatibility.
  - Use a task worktree and PR, record no private production rows, run Frog
    inspection, and complete the preliminary and final review gates.

## Risks and mitigations

1. Risk: A generic Junction connector label could still hide the actual source.
   Mitigation: Prefer the job's normalized source slug, then the verified
   webhook-level source, with the connector as the final direct/unknown fallback.
2. Risk: Deduped timing hints from different sources could be mislabeled.
   Mitigation: Merge source attribution only when it matches exactly; omit it
   on disagreement while retaining the conservative duration merge.
3. Risk: Reusing execution `sourceProviderSlug` for timing attribution could
   split connector-wide Junction work and duplicate imports.
   Mitigation: Keep provider-owned execution source unchanged and carry
   attribution in a separate optional timing-only field that is excluded from
   dirty identity, counters, job payloads, and executor routing.
4. Risk: A source label could become an unbounded or identifying log value.
   Mitigation: Use the existing runtime-log code sanitizer and assert that
   identifiers, payloads, event/resource semantics, and health values remain absent.
5. Risk: Web and warm runner containers may deploy at different times.
   Mitigation: Keep every new field optional. Old runners ignore the additive
   dirty metadata; new runners fall back to the existing connector label when
   older Web producers omit source attribution.

## Tasks

1. Map current source attribution from provider parsing through Web dirty
   persistence, runtime job promotion, and buffered log emission.
2. Propagate the verified source through the existing carriers with honest
   coalescing and sanitized log output.
3. Add focused Garmin, Fitbit, direct-provider, merge, and privacy regressions.
4. Update the canonical ingestion and runtime-log contracts and run focused
   tests/typechecks plus diff/privacy inspection.
5. Commit and push the exact candidate, open the PR, run preliminary ReviewGPT
   concurrently with CI, resolve findings, run the final sensitive ReviewGPT
   gate, merge/deploy when authorized, prove the live additive field, and retire
   the task worktree.

## Decisions

- Add `timingSourceProviderSlug` to the existing dirty-resource carrier rather
  than reusing execution `sourceProviderSlug`. This is metadata on the existing
  owner, not a new state owner, and preserves connector-wide job cardinality.
- Preserve three timing-source states across deployment skew: omitted means an
  older producer and uses legacy fallback, a string is exact attribution, and
  explicit `null` means coalesced sources disagreed and must be omitted.
- Keep both connector `provider` and wearable `sourceProvider` because they
  answer different operational questions (delivery path versus source).
- Do not broaden the event to polling-only jobs. The existing event is tied to
  admitted webhook evidence; queue/execution-only coverage for every pull would
  require a second completion association and would still not make this an
  exhaustive ledger.

## Verification

- Commands to run:
  - Focused Vitest files for hosted Web wake shaping and assistant-runtime
    timing promotion/log emission.
  - Affected package/app typechecks selected from package scripts.
  - `git diff --check`, scoped secret/privacy scans, and candidate review.
  - Exact-head required GitHub Actions, preliminary `completion-specialists`,
    and final ReviewGPT.
- Expected outcomes:
  - Garmin and Fitbit webhook jobs retain their source in the completion log;
    Oura/WHOOP/Strava remain attributable through connector fallback.
  - Mixed-source timing merges omit `sourceProvider` instead of choosing one.
  - Existing timing dimensions, canonical imports, dirty acknowledgement, and
    retry behavior are unchanged.
  - No raw health timing, health data, webhook payload, member/device id, or
    other direct identifier enters telemetry or committed artifacts.

## Progress

- 2026-08-11: Root cause confirmed: source attribution already reaches the
  hosted dirty resource, but the pass-local timing carrier and runtime log drop
  it. Garmin/Fitbit require no new provider parser.
- 2026-08-11: Implemented source propagation, direct-provider fallback,
  exact-match coalescing, sanitized log output, and canonical doc updates.
- 2026-08-11: Preliminary ReviewGPT found that the first candidate reused the
  execution-source field and could split source-free Junction reconcile work.
  Accepted the finding and separated timing attribution from job identity.
- 2026-08-11: Focused proof passed:
  - assistant-runtime timing/promotion/logging: 164 tests
  - hosted Web webhook admission/dirty shaping: 123 tests
  - assistant-runtime, device-syncd, and hosted Web typechecks
  - focused hosted Web ESLint and `git diff --check`
- 2026-08-11: Initial exact-head CI passed. Preliminary ReviewGPT completed with
  the accepted cardinality finding above.
- 2026-08-11: Final ReviewGPT round 1 independently found the same cardinality
  issue on the immutable first-reviewed head. The finding was accepted and
  remediated with the separate timing-only carrier described above.
- 2026-08-11: Remediation focused proof passed:
  - hosted Web ingestion and dirty-store coalescing: 147 tests
  - assistant-runtime timing/promotion/logging: 165 tests
  - shared hosted-runtime timing parsing: 95 tests
  - assistant-runtime, device-syncd, and hosted Web typechecks
  - focused hosted Web ESLint, `git diff --check`, and privacy scan
- 2026-08-11: Corrected exact-head CI passed with 16 successful checks, zero
  failures, and one intentional environment-gated skip.
- 2026-08-11: Final sensitive ReviewGPT round 2 used a fresh full snapshot of
  the corrected head, verified the requested review model through its response
  sidecar, found no qualifying issues, and returned `ROUND_OUTCOME: PASS`.
- 2026-08-11: Parent final review re-read the changed producer, persistence,
  parser, runner, and logging paths; confirmed timing attribution is excluded
  from execution identity and routing; and found no remaining proof gap.
- Pending after plan closure: exact-head CI for the metadata-only archive
  commit, merge/deploy proof, live additive telemetry proof, and worktree
  retirement.
Completed: 2026-08-11
