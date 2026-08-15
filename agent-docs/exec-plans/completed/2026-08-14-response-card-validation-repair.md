# Repair response-card validation feedback and schema compatibility

Status: completed
Created: 2026-08-14
Updated: 2026-08-15

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
   Mitigation: add representative provider-valid compatibility coverage for
   every discriminated card kind, keep inline-representable rejections aligned, and
   prove deliberate provider-permissive/runtime-rejected cardinality, workout
   relation, and aggregate-payload cases return authoritative repair hints.

## Tasks

1. Completed: inspect the authoritative card schemas, offered JSON schema, and current
   validation-digest privacy boundary.
2. Completed: capture and inspect the fresh ReviewGPT implementation artifact.
3. Completed: implement the smallest shared safe-path and response-card repair-hint change.
4. Completed: add focused privacy, one-retry repair, and schema-compatibility
   regression tests.
5. Completed: merge current main normally, preserving its accepted workout-card
   capacity behavior and this patch's bounded diagnostic behavior.
6. Completed: remediate final-review rounds two through four while preserving
   authoritative refinement ownership, exact accepted values, and provider
   schema compatibility.
7. Completed: remove alternative-union flattening from diagnostics, add one
   truthful family-choice hint for absent or invalid card kinds, run focused and
   proportional verification, and complete the remaining ReviewGPT/CI gates
   without merging.

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
- Select one compact-table diagnostic branch from the schema-owned generic or
  workout fields before building repair hints. Ambiguous and hybrid shapes get
  one bounded card-level shape-choice hint; the authoritative acceptance union
  remains unchanged.
- Attach static expected-shape tokens to the authoritative custom refinements
  that know why an input failed. The shared digest accepts only bounded safe
  tokens from issue metadata; it never infers custom semantics from a path or
  forwards a refinement message or submitted value.
- Preserve main's semantic-workout oversized-envelope text fallback. Only the
  diagnostic selection and repair description change; acceptance and execution
  authority do not.
- Never turn mutually exclusive union alternatives into simultaneous repair
  requirements. Exact discriminators select an existing diagnostic schema;
  an absent or invalid response-card family discriminator gets one bounded
  `card.kind` choice hint, while the acceptance union remains authoritative and
  unchanged.

## Verification

- Passed: safe-digest, audience-scoped diagnostics, and one-retry response-card
  focused tests, including mutually exclusive compact-table branch hints.
- Passed: existing response-card tool suite (26 tests).
- Passed: operator-config response-card tests and the 4,913-byte schema
  compaction boundary (24 tests); exact-head full operator-config package
  coverage passed (39 files, 345 tests).
- Passed: offered JSON schema versus runtime compatibility and deliberate
  provider-permissive cardinality, pending-workout-set, and aggregate-payload
  repair proofs (3 tests).
- Passed: the real App Server same-turn private invalid-call/corrected-call/card
  delivery proof and a separate malformed group-card feedback proof (2 tests).
- Passed: operator-config, assistant-engine, and CLI package typechecks.
- Passed: full assistant-engine coverage with an 8 GB Node heap (240 files
  passed, 1 skipped; 3,740 tests passed, 79 skipped). The default 4 GB heap
  attempt exhausted memory before completing; no product failure was observed.
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
- Passed after the normal main merge: focused safe-digest and response-card
  feedback tests (10 tests); private same-turn and group-audience App Server
  tests (2 passed, 78 skipped); compact-table and workout contract tests (23
  tests); CLI schema-compatibility tests (3 tests); operator-config response-card
  tests (15 tests); and assistant-engine, contracts, CLI, and operator-config
  typechecks. The round-two metadata-only refinement changes do not alter the
  offered provider schema or the previously captured direct/group request
  delta.
- Merged current main at `c561eed4410ff2fa76be4944283760bfccd1be03`
  through two-parent merge `60806e03dc6872e5570bb4a4743961253f83ed5e`.
  The two conflicts were the compact-table dynamic-tool boundary and compact
  table contract; resolution preserves main's semantic workout capacity/fallback
  and this PR's privacy-safe, audience-scoped repair hints.
- Passed on exact reviewed production head `fcf53e4f73b3323476db5e549d1f481bdf0d32f2`:
  safe digest and response-card validation (12 tests), response-card tool (27
  tests), CLI schema compatibility (3 tests), operator response-card and schema
  size (25 tests), and the assistant-engine, contracts, CLI, and operator-config
  typechecks. The provider schema remains 4,913 bytes and the prior provider
  input measurement remains +10 direct tokens and zero group tokens.
- Passed: exact-head GitHub build/typecheck, app verification, assistant/CLI/
  platform package coverage, host matrices, sandbox, billing, fixture, artifact,
  frontend, and overflow checks.

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

## Final review round 1 disposition

- Accepted the compact-table cross-branch diagnostic finding. Diagnostics now
  choose exactly one existing contract schema, generic and workout failures
  exclude the other branch's fields, and the same-turn App Server proof starts
  with a genuinely malformed nested generic card.
- Updated the existing pending-vault-file diagnostic assertion for the shared
  conventional array path (`intentIds[]`) and explicitly covered the new
  metadata-only issue shape and summary; submitted content remains absent.

## Final review round 2 disposition

- Accepted the custom path-only mapping finding. A root `card` custom issue can
  mean either ambiguous compact-table shape or aggregate payload size, so the
  formatter no longer guesses custom semantics from paths.
- Authoritative custom refinements now emit static, bounded expected-shape
  tokens for compact-table cardinality and payload size, nutrition relations,
  workout set/state relations, and the workout subtitle rule. The synthetic
  ambiguity issue owns its separate shape-choice token.
- Added provider-permissive pending-set and aggregate-size regression cases,
  exact corrected retries, same-turn terminal delivery, ambiguity retention,
  and metadata-only privacy coverage. Oversized generic cards now receive the
  payload-limit hint and never the ambiguity hint.

## Final review round 3 disposition

- Completed the mandatory round-three retrospective. Review remediation grew
  authored source by +41/-18 (net +23) from the immutable first-reviewed head;
  the two accepted mechanisms are distinct, use existing owners, and are kept
  together because splitting authoritative refinements from the safe
  digest/formatter would weaken the one-retry invariant.
- Accepted the lowercase-token finding. The nutrition meal-count refinement's
  `at_most_card.mealCount` token was rejected by the intentionally strict safe
  token grammar, so it is now `at_most_card.meal_count`; the sanitizer remains
  unchanged and the deleted path map remains deleted.
- Added provider-valid/runtime-invalid nutrition meal-count compatibility,
  digest/formatter, strict mixed-case rejection, and corrected-parser proofs.
  Focused assistant and CLI tests and the assistant/contracts/CLI typechecks
  pass; exact-head broad CI remains the final verification owner.

## Final review round 4 disposition

- Accepted the nested optional-metric union finding. Flattening the supported
  and unavailable macro branches made alternative requirements look
  simultaneous for provider-valid hybrid inputs such as a null total with a
  positive meal count.
- Replaced only that union at its existing contract owner with one strict object
  and an equivalent `total === null` iff `mealCount === 0` refinement. The
  refinement owns one `zero_iff_total_null` repair token at the meal-count field;
  no diagnostic discriminator or acceptance owner was added.
- Both invalid hybrid directions now return exactly one bounded relation hint;
  the supported and unavailable valid shapes still pass. Compatibility tests,
  raw-value-free feedback assertions, the existing same-turn App Server repair
  journey, focused operator tests, and all four affected package typechecks pass.

## Final review round 5 disposition

- Completed the renewed retrospective after the top-level response-card family
  union exposed the same alternative-flattening mechanism found in rounds one
  and four. Mutually exclusive alternatives are now a single architectural
  class: they must never be emitted as concurrent repair requirements.
- Removed the recursive invalid-union flattener and its bounds/helpers. Exact
  response-card kinds continue to select one authoritative family/shape schema;
  absent or invalid kinds on object cards receive exactly one diagnostics-only,
  allowlisted `card.kind` family-choice hint. Acceptance and execution schemas
  are unchanged.
- Added generic union non-flattening coverage plus missing-kind, malformed-kind,
  privacy, exact-feedback, and corrected-retry response-card proofs. Existing
  selected-family nested repair coverage remains the regression owner.

## Final review round 6 disposition

- ReviewGPT returned `ROUND_OUTCOME: PASS` and `REVIEW_COMPLETE` with no
  qualifying findings after a fresh full-snapshot audit of the exact reviewed
  production head.
- The configured ReviewGPT/Pro staging evidence is accepted for this task. The
  response itself reported `MODEL_CONFIRMATION: UNKNOWN`; that self-confirmation
  limitation is recorded and was not represented as stronger evidence.
- Corrected the PR-body-only source arithmetic to +419/-63, total +1,908/-65,
  and net -17 authored-source remediation versus the immutable first-reviewed
  head. No production, test, schema, or runtime behavior changed after the PASS.
Completed: 2026-08-15
