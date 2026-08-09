# Preserve response-card schema through Codex

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Restore reliable `daily_nutrition` and `compact_table` response-card
  attachment by keeping the model-facing tool schema below Codex's schema
  compaction threshold without changing the canonical runtime card contract.

## Success criteria

- The response-card tool exposes only the current nutrition V2 and compact-table
  V1 authoring contracts, with their nested field shapes intact.
- The runtime parser still accepts retained nutrition V1 cards as well as the
  current card formats.
- A regression test fails before the full tool input schema reaches the pinned
  Codex App Server's 5,000-byte compaction boundary.
- Focused tests, package typechecks, and a real App Server probe pass for both
  card kinds.

## Scope

- In scope: response-card JSON Schema generation, focused schema and tool tests,
  and direct App Server verification.
- Out of scope: card persistence, rendering, delivery, prompts, unrelated tool
  schemas, and removal of nutrition V1 runtime compatibility.

## Constraints

- Technical constraints: retain one attachment tool and one canonical runtime
  parser; derive the model schema from the existing Zod contracts; do not add a
  second state or delivery owner.
- Product/process constraints: preserve already-stored V1 cards, avoid exposing
  private production evidence, and use the hosted-runtime PR verification lane.

## Risks and mitigations

1. Risk: removing V1 from model authoring could accidentally remove V1 runtime
   support.
   Mitigation: leave `assistantResponseCardSchema` unchanged and retain explicit
   V1 parser coverage.
2. Risk: later schema growth could trigger silent Codex compaction again.
   Mitigation: guard the Codex-normalized full tool input below 5,000 bytes, not
   only the nested card schema.
3. Risk: hand-maintained JSON Schema could drift from the canonical contracts.
   Mitigation: continue generating it directly from the current Zod schemas;
   keep the small Codex normalization projection test-only and pinned to the
   deployed App Server boundary.

## Tasks

1. Separate the current model-authoring union from the compatibility-preserving
   runtime union.
2. Generate a current-only inline schema and add normalized-size boundary
   regression coverage.
3. Run focused tests, package typechecks, and real App Server probes for both
   response-card kinds.
4. Review the exact diff, commit, open the PR, and complete CI and ReviewGPT
   gates.

## Decisions

- Keep a single `attach_response_card` tool. Splitting tools would introduce a
  second model-facing capability and duplicate authorization guidance.
- Keep nutrition V1 only in the runtime union. New tool calls author V2, while
  retained and replayed V1 cards remain valid.
- Keep the model schema inline. The deployed App Server drops local definitions
  during large-schema compaction, so reference reuse cannot preserve nested
  authoring shapes.
- Retain one deterministic pinned-App-Server regression in the existing
  scripted-runtime suite. It proves the provider-visible nested shapes and both
  runtime tool calls without introducing another harness.

## Verification

- Commands to run: focused operator-config and assistant-engine Vitest files;
  both package typechecks; `git diff --check`; privacy scan; real App Server
  probes for current nutrition and compact-table cards.
- Expected outcomes: all checks pass; both probes produce canonical arguments
  without a tool-schema rejection; the complete tool input remains below 5,000
  Codex-normalized bytes.
- Completed outcomes: the focused card suites pass (16 tests), the expanded
  pinned-App-Server and card-tool suites pass (40 tests), both affected package
  typechecks pass, and the live Sol probes accepted nutrition V2 and compact
  table cards. Required exact-head CI is green, preliminary specialist findings
  are resolved, and final ReviewGPT round 2 passed with no qualifying findings.

## Review dispositions

- Accepted the preliminary coverage finding. The temporary live proof is now
  backed by a committed test at the existing real App Server/local Responses
  boundary; no coverage patch artifact was supplied.
- Accepted the final Purpose Drift disclosure finding. A changed tool contract
  intentionally rotates eligible native threads once so thread-start can adopt
  the new schema; the PR contract documents bounded transcript continuity,
  conditional hot-path work, rollback behavior, and the two-turn deployment
  smoke. No compatibility mechanism is warranted.
Completed: 2026-08-09
