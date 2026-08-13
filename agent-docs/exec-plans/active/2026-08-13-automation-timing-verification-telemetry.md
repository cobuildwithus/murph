# Automation timing verification telemetry and recovery UX

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- When an automation write succeeds but its immediate scheduler readback is
  temporarily inconclusive, Murph performs one read-only inspection before
  replying, gives a concise truthful confirmation, and emits typed secret-safe
  diagnostics that identify why verification was incomplete.

## Success criteria

- Automation responses preserve the existing canonical vault and cron owners and
  add a finite typed verification-reason projection without new durable state.
- A write with unverified timing causes exactly one read-only inspect attempt in
  the same assistant turn; it never retries the write or creates a fallback
  automation.
- A recovered inspection produces the normal verified confirmation. An
  unresolved inspection confirms only the stored schedule/status, explains the
  remaining uncertainty without asking the member to authorize an inspection,
  and makes no unverified next-occurrence claim.
- Hosted runtime logs capture content-free issue codes and whether the bounded
  inspection recovered verification.
- Focused assistant-engine and assistant-runtime tests plus relevant typechecks
  pass, required exact-head CI is green, and both ReviewGPT stages are resolved.

## Scope

- In scope: the existing cron timing projection result, hosted automation tool
  response and redacted diagnostics, automation tool serialization, assistant
  instructions, and focused regression coverage.
- Out of scope: scheduler cadence, delivery retries, canonical automation
  storage, new queues or reconciliation owners, database schema, and unrelated
  reminder behavior.

## Constraints

- Technical constraints: preserve `timingVerified` compatibility; derive every
  diagnostic from existing owner facts; keep observability best-effort and off
  the reply critical path; use only bounded operation-local recovery state.
- Product/process constraints: do not expose private conversation content or
  identifiers; do not imply a next run is confirmed when it is not; use the
  exact pushed-head preliminary specialist and final ReviewGPT gates.

## Risks and mitigations

1. Risk: recovery instructions could trigger a duplicate write.
   Mitigation: require one `inspect` call by the returned lookup id and forbid
   write retry or fallback creation.
2. Risk: telemetry could leak automation content or identifiers.
   Mitigation: log only fixed schema/type, action, issue codes, and recovery
   outcome through the existing redaction pipeline.
3. Risk: a broad scheduler refactor could change delivery semantics.
   Mitigation: leave scheduling and runtime-state ownership unchanged; extend
   only the existing projection boundary and response composition.

## Tasks

1. Add typed reasons to the existing cron timing projection and hosted tool
   response while preserving the boolean compatibility field.
2. Feed incomplete/recovered verification observations into the existing
   assistant automation-detail log stream.
3. Update the automation instruction stack so the model performs one automatic
   inspect and gives truthful, non-alarming fallback copy.
4. Add focused serialization, prompt, recovery-behavior, and runtime telemetry
   regressions.
5. Run focused tests/typechecks, inspect the privacy-safe diff, publish the PR,
   and resolve ReviewGPT plus required CI.

## Decisions

- The false result is not a failed write: it combines several scheduler/readback
  states into one boolean, while the instruction stack currently delegates the
  next read back to the member. Preserve that safety boundary and improve its
  reason projection, automatic read-only recovery, and final copy.
- Do not clear or reinterpret active cron runtime state merely to make
  confirmation succeed. That state can represent a real in-flight or pending
  delivery and remains owned by the scheduler.
- Reuse `assistant.automation_detail`; no new log store, event transport, table,
  queue, or persisted recovery record is warranted.

## Verification

- Commands to run: focused Vitest suites for cron projection, hosted automation
  tool/telemetry, dynamic tool serialization, and prompt/scripted behavior;
  package typechecks selected through the repository verification guide; PR
  exact-head CI; preliminary `completion-specialists` and final `pr-review`.
- Expected outcomes: one inspect after an unverified write, no repeated write,
  verified recovery copy when available, typed unresolved copy otherwise,
  content-free runtime diagnostics, and no test/type regression.

## Progress

- Added typed scheduler-owned reasons for pending runtime work and a stale
  recurring projection, then composed them with the existing timezone,
  projection, and readback checks at the hosted tool boundary.
- Added one operation-local lookup set that observes incomplete write results
  and matching inspection recovery without persisting state or changing
  scheduler behavior.
- Updated the system prompt and deferred automation contract to inspect once,
  avoid duplicate writes, translate internal reasons into calm member-facing
  language, and never delegate the verification step back to the member.
- Added content-free warning and recovery events through
  `assistant.automation_detail`; regression proof asserts that title,
  instructions, slug, and conversation-route data do not enter the payload.
- Focused proof passed: 361 scheduler/prompt/scripted tests, 19 dynamic-tool
  tests, and 285 hosted runtime tests. The complete assistant-engine suite also
  passed 3,685 tests with 67 intentional skips, and the complete hosted runtime
  suite passed 2,256 tests with 4 intentional skips.
- Affected package typechecks passed. One broader affected-suite invocation was
  invalidated when a concurrently started dependency build replaced CLI build
  outputs; the already-completed engine/runtime results remain valid and the
  CLI lane is being rerun sequentially.
- Complete first provider-visible request capture used the pinned Codex App
  Server, scripted Responses endpoint, `gpt-5.6-terra`, low reasoning,
  production code mode, identical synthetic direct/group automation inputs,
  and `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized `include`, `input`,
  `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools`,
  excluding transport-only fields identically. Direct changed from 28,421
  tokens / 129,887 bytes to 28,568 / 130,670 (+147, +0.5172%; +783 bytes,
  +0.6028%). Group changed from 24,892 tokens / 112,864 bytes to 25,039 /
  113,647 (+147, +0.5905%; +783 bytes, +0.6938%). The delta is entirely the
  assembled timing-recovery instructions; initial tool/schema/generated
  guidance and other included fields are unchanged. The deferred automation
  description, when loaded, grows from 1,174 tokens / 6,129 bytes to 1,339 /
  7,055 (+165 tokens / +926 bytes). Temporary capture code was removed.
