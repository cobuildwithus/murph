# Repair response-card validation feedback and schema compatibility

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
  tool boundary, schema/runtime compatibility proof, and synthetic regression
  tests.
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
   Mitigation: add representative provider-valid parity coverage for every
   discriminated card kind, keep inline-representable rejections aligned, and
   prove the deliberate provider-permissive/runtime-rejected cardinality case
   returns an authoritative repair hint.

## Tasks

1. Completed: inspect the authoritative card schemas, offered JSON schema, and current
   validation-digest privacy boundary.
2. Completed: capture and inspect the fresh ReviewGPT implementation artifact.
3. Completed: implement the smallest shared safe-path and response-card repair-hint change.
4. Completed: add focused privacy, one-retry repair, and schema-compatibility
   regression tests.
5. In progress: run focused tests, typecheck, diff/privacy review, ReviewGPT gates, commit,
   push, and open a PR without merging.

## Decisions

- Keep repair feedback ephemeral in the tool result; do not persist new
  diagnostics.
- Preserve the existing response-card parser as the only acceptance owner.
- Use the already-known direct/group turn audience only to choose the offered
  repair schema for malformed root arguments; acceptance and execution
  authority remain unchanged.
- Keep compact-table column/value cardinality runtime-owned. Enumerating every
  cross-array cardinality in inline JSON Schema exceeds the pinned App Server's
  5,000-byte compaction boundary; the offered schema remains permissive for
  this one refinement and the runtime returns the exact repair hint.
- Use bounded structured JSON hints and omit received shapes and submitted
  values from the model-facing failure response.

## Verification

- Passed: safe-digest, audience-scoped diagnostics, and one-retry response-card
  focused tests (7 tests).
- Passed: existing response-card tool suite (26 tests).
- Passed: operator-config response-card tests and the 4,911-byte schema
  compaction boundary (24 tests); exact-head full operator-config package
  coverage passed (39 files, 345 tests).
- Passed: offered JSON schema versus runtime compatibility and deliberate
  provider-permissive refinement proof (2 tests).
- Passed: the real App Server same-turn private invalid-call/corrected-call/card
  delivery proof and a separate malformed group-card feedback proof (2 tests).
- Passed: operator-config, assistant-engine, and CLI package typechecks.
- Passed: normalized complete first-provider request capture with the pinned
  real Codex App Server, `gpt-5.6-terra`, low reasoning, production code mode,
  identical synthetic direct/group turns, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. Direct changed from 29,245 tokens / 135,018 bytes to 29,255
  / 135,065 (+10 tokens, +0.0342%; +47 bytes, +0.0348%). Group remained
  23,467 tokens / 107,773 bytes. The selected provider fields were `include`,
  `input`, `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and
  `tools` when present; model/reasoning/storage/streaming/service-tier/account/
  cache/client/transport metadata were excluded identically. The direct delta
  is confined to Codex-generated code-mode tool-schema guidance in `input`;
  temporary paths and generated ids were normalized, and capture code and
  payloads were removed.

## Preliminary review dispositions

- Accepted the schema-budget and hybrid-card finding. Cross-array cardinality
  remains a runtime refinement, both provider variants now reject the opposite
  variant's fields, and the 5,000-byte owner test passes.
- Accepted the audience-selection finding. Missing or misspelled private root
  arguments now receive only private-card hints, while malformed group calls
  receive only group-card hints; submitted keys and values remain absent.
- Accepted the same-turn journey-proof finding. The production App Server
  harness now proves invalid call, bounded repair result, corrected call, and
  terminal card delivery in one inbound turn.
