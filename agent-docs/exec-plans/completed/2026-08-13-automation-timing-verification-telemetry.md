# Automation timing verification telemetry and recovery UX

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- When an automation write succeeds but its immediate scheduler readback is
  temporarily inconclusive, Murph performs one internal read-only readback before
  replying, gives a concise truthful confirmation, and emits typed secret-safe
  diagnostics that identify why verification was incomplete.

## Success criteria

- Automation responses preserve the existing canonical vault and cron owners and
  add a finite typed verification-reason projection without new durable state.
- A write with unverified timing causes exactly one host-owned read-only
  readback before the tool returns; it never adds a provider continuation,
  retries the write, or creates a fallback automation.
- A recovered readback produces the normal verified confirmation. An
  unresolved readback confirms the write and current stored schedule/status,
  without claiming a superseded concurrent edit still holds, explains the
  remaining uncertainty without asking the member to intervene,
  and makes no unverified next-occurrence claim.
- Hosted runtime logs capture content-free issue codes and whether the bounded
  readback recovered verification.
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
  the reply critical path; keep recovery inside the existing hosted tool owner
  without correlation state.
- Product/process constraints: do not expose private conversation content or
  identifiers; do not imply a next run is confirmed when it is not; use the
  exact pushed-head preliminary specialist and final ReviewGPT gates.

## Risks and mitigations

1. Risk: recovery instructions could trigger a duplicate write.
   Mitigation: keep one readback inside the existing tool owner and forbid
   provider-driven recovery, write retry, or fallback creation.
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
3. Update the automation instruction stack so the tool owns one automatic
   readback and the model gives truthful, non-alarming fallback copy.
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
- Expected outcomes: one internal readback after an unverified write, no repeated write,
  verified recovery copy when available, typed unresolved copy otherwise,
  content-free runtime diagnostics, and no test/type regression.

## Progress

- Added typed scheduler-owned reasons for pending runtime work and a stale
  recurring projection, then composed them with the existing timezone,
  projection, and readback checks at the hosted tool boundary.
- Moved the deterministic readback into the existing authenticated hosted tool
  owner, eliminating a provider continuation, prompt-owned sequencing, and the
  operation-local lookup correlation set from the first candidate.
- Kept the complete member-facing terminal rule in the deferred automation
  contract: acknowledge the write and current stored state, translate internal reasons
  into calm language, make no unverified timing claim, and never delegate the
  verification step back to the member.
- Added content-free initial and final verification events through
  `assistant.automation_detail`; regression proof asserts that title,
  instructions, slug, schedule values, and conversation-route data do not enter
  the payload. Both events are informational so the existing nonblocking log
  queue keeps observability off foreground delivery.
- Focused proof passed: 361 scheduler/prompt/scripted tests, 19 dynamic-tool
  tests, and 285 hosted runtime tests. The complete assistant-engine suite also
  passed 3,685 tests with 67 intentional skips, and the complete hosted runtime
  suite passed 2,256 tests with 4 intentional skips.
- Affected package typechecks passed. The corrected hosted phase and log-queue
  suites pass 298 tests and cover recovered, persistent, concurrent-mismatch,
  projection-failure, content-redaction, and nonblocking-log behavior.
- Repeated complete first provider-visible request capture against the current
  PR base and corrected head used the pinned Codex App
  Server, scripted Responses endpoint, `gpt-5.6-terra`, low reasoning,
  production code mode, identical synthetic direct/group automation inputs,
  and `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized `include`, `input`,
  `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools`,
  excluding transport-only fields identically. Direct changed from 26,553
  tokens / 120,182 bytes to 26,549 / 120,182 (-4, -0.0151%; zero bytes).
  Group changed from 22,994 tokens / 104,439 bytes to 22,977 / 104,439 (-17,
  -0.0739%; zero bytes). The initial-request delta is entirely the assembled
  automation guidance; tool/schema/generated guidance and all other included
  fields are unchanged. The deferred automation description, when loaded,
  grows from 1,173 tokens / 6,097 bytes to 1,356 / 7,145 (+183 tokens / +1,048
  bytes). The measured base is `ca55da9d1a3576d36eefba5bf92a22c65f06b22b`;
  temporary capture code and payloads were removed.
- Draft PR #1763 is open. Its public changelog item validates with all seven
  focused fragment tests and describes the self-checking reminder update
  without exposing incident or conversation details.
- Preliminary ReviewGPT and final round 1 both returned findings on the first
  reviewed head. Accepted: warning-level telemetry could block foreground
  delivery; deterministic recovery did not belong in another model
  continuation; unresolved copy must acknowledge the requested mutation; and
  persistent/mismatch/projection failure needed stronger production-boundary
  proof. The corrected implementation resolves those findings without a new
  owner, queue, state machine, or retry path. The preliminary pass was not
  rerun; final round 2 reviewed the behavior-bearing correction.
- Corrected-head product-experience revalidation found no remaining finding or
  material evidence gap: the smallest complete experience is the existing
  write followed by one invisible host-owned readback only when needed, then
  one calm confirmation in the initiating conversation. Persistent uncertainty
  adds no choice, click, setup, provider continuation, or unsupported promise.
- Final ReviewGPT round 2 reviewed the sensitive full snapshot at
  `459a716f2ba57f852d14a29a5f6d79dd19d17b0e`, verified every accepted finding's
  correction, and returned `ROUND_OUTCOME: PASS` with no qualifying findings.
  The requested Pro model was verified as `gpt-5-6-pro`; its only notes were
  corrected PR-body line-count arithmetic.
- Exact-head GitHub checks are green, including assistant, CLI, platform, and
  app coverage plus release build/typecheck. The final privacy/path scan and
  `git diff --check` are clean. One local full assistant-engine attempt exceeded
  the worker memory ceiling after 3,659 passing tests; all changed engine paths
  passed locally and the exact-head assistant coverage lane passed in CI.
Completed: 2026-08-13
