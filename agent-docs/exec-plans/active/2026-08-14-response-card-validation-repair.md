# Repair response-card validation feedback and schema parity

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Let Codex repair an invalid `attach_response_card` call in one retry using
  bounded, privacy-safe field and validation-code hints, while keeping the
  offered JSON schema aligned with the authoritative runtime validator.

## Success criteria

- Invalid synthetic card inputs report schema-owned nested paths and stable
  validation codes without echoing submitted values or private content.
- Hints are bounded and contain only schema-owned fields, validation codes,
  and expected-shape tokens.
- Valid inputs accepted by the offered tool schema remain accepted by the
  authoritative Zod/refinement validator for each supported card family.
- Focused tests and the assistant-engine typecheck pass.
- The completed patch passes the required ReviewGPT and PR checks.

## Scope

- In scope: the shared safe validation digest, the response-card attachment
  tool boundary, schema/runtime parity proof, and synthetic regression tests.
- Out of scope: response-card delivery, persistence, rendering, production log
  retention, unrelated dynamic tools, or a new diagnostics store.

## Constraints

- Technical constraints: the runtime Zod schema remains authoritative; reuse
  the current safe-digest owner; do not add a second schema or state owner.
- Product/process constraints: no submitted values, card contents, direct
  identifiers, paths, or private diagnostics may enter errors, tests, plans,
  PR text, or durable metadata.

## Risks and mitigations

1. Risk: nested issue paths can reveal attacker-controlled object keys.
   Mitigation: retain only path segments that can be proved to belong to the
   authoritative schema and cap issue/path/hint counts and lengths.
2. Risk: a hand-maintained JSON schema can drift from refinements that JSON
   Schema cannot express.
   Mitigation: add representative accepted/rejected parity coverage for every
   discriminated card kind and encode repair guidance only from authoritative
   Zod issues.

## Tasks

1. Completed: inspect the authoritative card schemas, offered JSON schema, and current
   validation-digest privacy boundary.
2. Completed: capture and inspect the fresh ReviewGPT implementation artifact.
3. Completed: implement the smallest shared safe-path and response-card repair-hint change.
4. Completed: add focused privacy, one-retry repair, and schema-parity regression tests.
5. In progress: run focused tests, typecheck, diff/privacy review, ReviewGPT gates, commit,
   push, and open a PR without merging.

## Decisions

- Keep repair feedback ephemeral in the tool result; do not persist new
  diagnostics.
- Preserve the existing response-card parser as the only acceptance owner.
- Encode compact-table column/value cardinality in the offered JSON schema so
  provider-side rejection and runtime refinement agree on the repairable case.
- Use bounded structured JSON hints and omit received shapes and submitted
  values from the model-facing failure response.

## Verification

- Passed: safe-digest and one-retry response-card focused tests (6 tests).
- Passed: existing response-card tool suite, including the 5,000-byte schema
  compaction boundary (26 tests).
- Passed: offered JSON schema versus runtime parity test (1 test).
- Passed: operator-config, assistant-engine, and CLI package typechecks.
