# Attribute hosted container-busy retries

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Explain the production `container_busy` retry burst by attributing every
  existing busy-return path to one closed, privacy-safe stage at the current
  UserRunner retry owner.
- Preserve runtime behavior exactly: telemetry remains best-effort,
  identifier-free in Analytics Engine, and unable to delay or alter retry,
  wake, preemption, fence, or user-visible processing behavior.

## Success criteria

- Every `container_busy` return site supplies one compile-time-required stage
  from a closed low-cardinality enum.
- The existing structured warning includes that stage and the existing
  Analytics Engine point adds only the stage dimension; row volume, index
  cardinality, retry timing, and control flow are unchanged.
- The operational SQL report groups sampling-corrected retry counts by reason
  and stage while remaining compatible with historical points.
- Focused tests prove the emitted shape, privacy boundary, best-effort failure
  behavior, representative busy-stage attribution, and SQL/report contract.
- Cloudflare typecheck, focused Vitest suites, privacy/log guards, required
  completion audits, final ReviewGPT review, and exact-head CI pass.

## Scope

- In scope:
  - `apps/cloudflare` UserRunner retry telemetry types, call-site attribution,
    existing Analytics Engine point, structured warning, focused tests, the
    existing retry report, and its durable README contract.
  - A privacy-safe later query over naturally emitted production points.
- Out of scope:
  - Runtime retry/preemption/fence behavior, retry delays, Temporal state,
    database state, new bindings/backends/queues/schedulers, unique attempt
    identifiers in Analytics Engine, synthetic production traffic, and
    device-sync behavior.

## Constraints

- Technical constraints:
  - Reuse `HOSTED_RUNTIME_RETRY_ANALYTICS`; do not add a binding or data owner.
  - Keep the existing reason as the sole Analytics Engine index. Put the stage
    in a blob so the index stays bounded; maximum stage cardinality is the
    finite number of current `container_busy` paths.
  - Do not emit user/workspace/message/command/health/provider data or any new
    identifier. Preserve the existing immediate best-effort `try/catch` write.
  - No additional database/network call, await, timer, retry, or persisted
    runtime state.
- Product/process constraints:
  - Internal telemetry only; Product UX is not applicable and no member-visible
    behavior may change.
  - The user explicitly overrode the production-sweep limit on concurrent
    telemetry PRs. All other automation and repository gates remain in force.
  - ReviewGPT exclusively authors production telemetry and remediation. The
    local owner inspects, applies, validates, commits, and owns the PR.
  - Draft PR #2448 changes the same controller region for mailbox behavior but
    not this telemetry boundary; require clean merge proof and do not merge on
    a substantive conflict.

## Risks and mitigations

1. Risk: stage values expose private work or expand cardinality.
   Mitigation: use semantic control-path labels only, with no processing-mode
   values, identifiers, content, errors, or free text; keep reason as the only
   Analytics Engine index.
2. Risk: telemetry changes retry behavior or adds hot-path latency.
   Mitigation: reuse the existing synchronous best-effort point and structured
   log, add no await or branch affecting the returned response, and prove the
   same retry response/timestamp in focused tests.
3. Risk: historical `v1` points disappear from the report.
   Mitigation: keep the query explicitly backward-compatible and test the
   schema predicate and stage grouping contract.
4. Risk: PR #2448 creates a moving same-file conflict.
   Mitigation: keep attribution additions mechanically local, inspect that PR's
   exact diff, and require current-base `merge-tree` proof before any merge.

## Tasks

1. Freeze the telemetry question, competing causes, owner boundary, privacy and
   cardinality constraints, and later verification query.
2. Give ReviewGPT the privacy-safe implementation packet and obtain its patch.
3. Inspect the full patch for scope, behavior preservation, privacy, cost,
   device overlap, and compatibility; return substantive mismatches to
   ReviewGPT rather than hand-editing production code.
4. Apply the accepted ReviewGPT patch and run focused tests, Cloudflare
   typecheck, direct privacy/report proof, and parent diff review.
5. Commit and push a draft PR candidate, then run the preliminary specialist
   and final ReviewGPT gates concurrently with exact-head CI.
6. Resolve accepted findings through ReviewGPT, close the plan, mark Ready only
   when every gate passes, and evaluate the telemetry-only autonomous
   merge/deployment conditions.

## Decisions

- Product UX: not applicable because the change is internal, behavior-preserving
  operational telemetry with no user-visible state or interaction.
- Existing owner: `RuntimeProcessingController.createRetryLater` and
  `createRuntimeProcessingRetryLater` already own the retry response, warning,
  and Analytics Engine point.
- Exact question: which closed UserRunner control path produced the
  `container_busy` burst?
- Competing causes to distinguish: non-runtime write-fence contention, active
  runtime mode contention, cooperative handoff waiting, unavailable or
  rejected preemption, and pending stopped-container state that could not yet
  be cleared. ReviewGPT must derive the final finite labels from current code
  and avoid encoding private processing-mode values.
- Future query: over a fixed UTC window, filter the existing retry schema,
  group sampling-corrected counts by retry reason plus optional busy stage, and
  compare the latest two hours with the preceding two hours. Historical rows
  without a stage must remain visible as unattributed rather than dropped.

## Verification

- Commands to run:
  - Focused `apps/cloudflare` Vitest files for retry responses, UserRunner busy
    paths, index/backpressure privacy, and operational report contracts.
  - `pnpm --dir apps/cloudflare typecheck`.
  - Repository privacy/log guard and diff-scoped checks selected by
    `agent-docs/operations/verification-and-runtime.md`.
  - Preliminary `completion-specialists` ReviewGPT pass and final ReviewGPT
    round against the exact pushed head, concurrent with required GitHub CI.
- Expected outcomes:
  - Every busy path emits exactly one finite stage in logs and Analytics Engine
    without any new identifier or free text.
  - Non-busy telemetry remains compatible, retry responses/timing are
    unchanged, Analytics write failure is swallowed, and the updated report
    includes historical points.
