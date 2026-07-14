# Appointment scheduling skill

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Make Murph collect a complete, bounded appointment brief before a real
  booking, rescheduling, cancellation, or waitlist action, regardless of
  whether execution uses a phone call, browser, or structured integration.
- Reuse known durable context before asking questions and save only
  user-approved reusable scheduling preferences to canonical Durable Memory.

## Success criteria

- Appointment work routes through one transport-neutral scheduling skill.
- The skill checks current context and canonical memory before asking, then
  requests only unresolved outcome-critical fields.
- A real appointment action cannot start until required fields and authority
  bounds are known; information-only and test calls remain separately usable.
- Phone and browser guidance delegate intake completeness to the new skill
  while retaining their existing transport ownership.
- Durable Memory writes are read-before-write, user-approved, reusable, and
  exclude sensitive or one-off appointment data.
- Focused tests, diff-selected verification, and prompt review pass.

## Scope

- In scope:
  - New `appointment-scheduling` skill and registry/router wiring.
  - Minimal phone-call and computer-use bridges to the skill.
  - Static regression coverage for readiness, memory, and ownership rules.
- Out of scope:
  - A new persisted appointment model, scheduling service, Retell agent, or
    phone-call schema.
  - Clinical diagnosis or replacement of domain skills that determine the
    appropriate care type.
  - Storing one-off appointment details or identifiers in freeform memory.

## Constraints

- Technical constraints:
  - Keep the generic call brief and existing browser execution surface.
  - Use existing `vault-cli memory` commands and canonical sections.
  - Preserve the manually maintained skill registry and compact prompt router.
- Product/process constraints:
  - Saved preferences are defaults, never current action or disclosure
    authorization.
  - Do not ask the user to repeat facts already established by reliable
    current context or canonical memory.
  - Preserve unrelated working-tree and coordination-ledger edits.
  - Run finite verification with `MURPH_VERIFY_SHARED_HOST=1` and host
    concurrency unset.

## Risks and mitigations

1. Risk: The skill becomes a long universal form that makes simple requests
   tedious.
   Mitigation: Separate universally required slots from appointment-type
   deltas, ask compact related questions, and exempt information-only calls.
2. Risk: "Save it to memory" causes sensitive or transient appointment data to
   persist.
   Mitigation: Persist only explicitly approved reusable preferences and
   standing rules; enumerate excluded data and verify every write.
3. Risk: Intake rules duplicate or conflict with browser and phone execution.
   Mitigation: Give the new skill semantic readiness ownership and leave
   transport mechanics with `computer-use` and `create_phone_call`.

## Tasks

1. Add and register the transport-neutral appointment scheduling skill.
2. Route appointment work to it from the compact router, phone guidance, phone
   tool description, and computer-use skill.
3. Add focused tests for completeness, memory boundaries, and transport
   ownership.
4. Run diff-selected shared-host verification and the prompt-primary completion
   audit; address evidence-backed findings.
5. Inspect the final diff for identifiers and unrelated edits, then create a
   scoped commit and archive this plan.

## Decisions

- Keep the existing generic phone-call schema and Retell agent; the missing
  contract is pre-call intake, not transport structure.
- Keep one-off appointment state in the active conversation/call brief. Use
  canonical Durable Memory only for approved reusable preferences, standing
  instructions, and verified provider or portal facts.
- Treat a connectivity test or information-only call as a bounded subtask, not
  completion of the real appointment workflow.
- Before asking the remaining intake questions, use a proportional read-only
  check of the destination's official site for its exact service labels and
  unusual requirements. For obvious appointment types, confirm and stop rather
  than expanding into broad medical research.

## Verification

- Commands to run:
  - `pnpm test:diff <exact touched paths>` with the shared-host profile enabled.
  - Required prompt review from `agent-docs/prompts/prompt-review.md`.
- Expected outcomes:
  - Relevant assistant-engine typecheck/tests pass.
  - Prompt review reports no unresolved evidence-backed findings.
- Results so far:
  - Final focused assistant-engine prompt/skill tests: 5 files and 109 tests
    passed after all prompt-review and scenario-review fixes.
  - Skill-creator validation: passed in an isolated temporary Python
    environment.
  - Prompt review: three findings accepted and fixed; fresh rerun reported no
    remaining evidence-backed findings.
  - First shared-host `pnpm test:diff` attempt timed out after 30 minutes waiting
    for the single host slot and did not begin verification.
  - The shared-host retry passed dependency policy, workspace boundaries,
    runtime guards, and all affected typechecks. Its package-test phase was
    blocked in the untouched `assistant-codex-runtime.test.ts`: one test timed
    out and left the suite's warm app-server busy, cascading into 138 later
    failures. The remaining 149 assistant-engine files passed 2,030 tests, and
    assistant-cli passed 22 files / 128 tests. No appointment-scheduling source
    or focused test failed.
Completed: 2026-07-14
