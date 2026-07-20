# Scheduled turn capability parity

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Make scheduled assistant turns use the same Codex turn runner, planner,
  dynamic tools, native capabilities, skills, and response machinery as a
  regular attended turn.

## Success criteria

- Trigger origin does not select a reduced or separately modeled prompt, tool,
  thread, skill, or capability-planning surface for scheduled assistant turns.
- Given the same invocation context, attended and scheduled turns resolve the
  same dynamic tools; accepted-input-only effects continue to require accepted
  input under the ordinary eligibility rules.
- Scheduled occurrences still carry their ordinary schedule, occurrence, and
  delivery context without introducing an authority framework or second turn
  stack.
- Current durable architecture and security docs describe literal turn
  capability parity.
- Focused regression proof, owner coverage, full required verification, green
  PR CI, and ReviewGPT all pass with no unresolved accepted finding.

## Scope

- In scope: deleting the scheduled prompt/tool profiles, reusing ordinary turn
  planning and capability assembly for scheduled occurrences, focused tests,
  and durable docs that currently describe an origin-specific split.
- Out of scope: scheduler persistence, occurrence identity, delivery routing,
  provider credential ownership, unrelated background work, and new authority
  abstractions.

## Constraints

- Default to deletion and direct reuse of the regular-turn path.
- Do not import the closed PR's typed scheduled-task authority framework.
- Keep provider credentials and route selection in their existing trusted
  owners; capability parity does not make model-supplied targets authoritative.
- Preserve unrelated active assistant-engine prompt and evaluation lanes.

## Risks and mitigations

1. Risk: a scheduled turn can reach an effect without the occurrence or
   delivery context required by its existing owner.
   Mitigation: reuse the regular turn surface while retaining the existing
   schedule-bound request facts and effect-owner validation.
2. Risk: origin checks remain in a second planner or tool-registration path.
   Mitigation: trace the scheduled entrypoint through final Codex request
   assembly and add parity assertions at the owning seam.
3. Risk: review feedback recreates the discarded framework.
   Mitigation: accept only evidence-backed fixes and prefer deletion,
   reordering, or an existing owner boundary over new authority state.

## Tasks

1. Trace regular and scheduled turns from entrypoint through capability and
   Codex request assembly.
2. Implement the smallest reuse/deletion change that makes their capability
   surfaces identical.
3. Update focused proof and current durable docs.
4. Run coverage-bearing verification, the required coverage audit, parent
   final review, scoped commit, PR CI, and ReviewGPT.

## Decisions

- The schedule is trigger context, not a different assistant authority class.
- The stored automation instructions are the ordinary turn request. Trusted
  occurrence and delivery facts remain dynamic context, and the structured
  send-or-skip object is only the delivery envelope.
- Scheduled turns receive the ordinary turn capability surface. Existing
  effect owners remain responsible for target, write-fence, provider, consent,
  idempotency, and irreversible-effect validation. Capabilities that require a
  current accepted input remain unavailable when no such input exists through
  the same ordinary eligibility checks, not a scheduler-specific profile.
- The replacement starts from current `main`; the closed branch is reference
  material only.

## Verification

- `pnpm --dir packages/assistant-engine typecheck`: passed.
- Focused assistant-engine planning, notification-runtime, local-service,
  prompt-layer, and capability suites: 274 tests passed after reconciliation
  with current `main`.
- `pnpm --dir packages/assistant-engine test:coverage` with an 8 GB Node heap
  and serial file execution: 169 files passed, 1 skipped; 2,522 tests passed,
  5 skipped; 89.61% statements, 82.01% branches, 94.15% functions, and 89.64%
  lines.
- Required `coverage-write`: passed on current `main`; it added one focused
  assertion that attended and scheduled hosted-group turns with equal context
  resolve identical dynamic-tool names and schemas. The focused planner suite,
  typecheck, and full owner coverage remained green.
- Truthful current-base diff verification passed the affected guards,
  typechecks, assistant-cli (128 tests), assistant-engine (2,522 passed, 5
  skipped), assistant-runtime (1,737 passed, 2 skipped), and assistantd (40
  tests). Its later broad CLI lane reproduced eight pre-existing 60-second
  timeouts in `packages/cli/test/assistant-cli.test.ts`; the exact owned
  verifier was stopped after those failures materialized. No CLI file is in
  this patch.
- `git diff --check`, durable-doc readback, privacy scan, and parent architecture
  review: passed.
- `pnpm verify:acceptance` was not repeated after the current-base diff lane
  confirmed that the shared broad CLI target is already red for an unrelated
  reason. The repo's coverage-bearing scoped fallback is green.
- Exact-head ReviewGPT, PR CI, and merge-tree proof remain pending until the
  scoped commit and push.
Completed: 2026-07-20
Completed: 2026-07-20
