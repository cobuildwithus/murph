# Generally available daily nutrition response card

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Let a member explicitly request the existing daily nutrition response card
  during any supported private-direct conversation.
- Preserve the existing canonical-read, private-audience, outbox, fallback,
  retry, and iMessage rendering owners without adding state or delivery paths.

## Success criteria

- Private-direct interactive turns receive `murph.attach_response_card`
  without requiring the automatic meal-closeout automation id.
- Group, maintenance, output-only, and native-capability-restricted turns keep
  their existing closed tool surfaces.
- The model-facing contract requires an immediately preceding single-date
  canonical meal-totals read and permits on-demand member requests as well as
  the existing managed closeout.
- The existing response-card schema, media conflict, outbox identity,
  capability fallback, and delivery behavior remain unchanged.
- Focused route-planning and tool-contract tests prove the new availability
  boundary and the unchanged private-direct restriction.

## Scope

- Delete the scheduled-automation availability condition from assistant turn
  planning.
- Update the existing response-card tool description and focused tests.
- Align the smallest durable response-card documentation with on-demand use.
- Publish the change through the required prompt, product-experience,
  coverage, and hosted-runtime ReviewGPT/CI gates.

## Constraints

- No new tool, capability flag, scheduler, queue, state owner, API, database,
  renderer, fallback, dependency, or compatibility layer.
- Cards remain private-direct and singular, and cannot coexist with response
  media.
- Card values must still come from the immediately preceding canonical
  single-date meal-totals read; never calculate or reuse stale totals.
- Goal snapshots retain the existing complete bounded active-goal rules.

## Tasks

1. [x] Delete the scheduled-only route-planning gate and update focused
   availability proof.
2. [x] Generalize the existing tool description without weakening canonical
   read, audience, or attachment rules.
3. [x] Update the minimum durable docs and run focused tests, typecheck, direct
   behavior proof, and provider-input measurement.
4. [ ] Push the candidate, open the draft PR, and run preliminary specialist
   and final ReviewGPT concurrently with exact-head CI.
5. [ ] Resolve accepted findings, complete parent review, close this plan, and
   prove final mergeability.

## Verification log

- Focused route-planning and response-card tool tests: 77 passed.
- Assistant Engine typecheck: passed.
- `git diff --check`: passed.
- Pinned Codex App Server plus local scripted Responses capture, model
  `gpt-5.6-terra`, low reasoning, code mode, and `gpt-tokenizer` 3.4.0
  `o200k_base`:
  - individual: 23,508 -> 23,759 tokens (+251, +1.0677%); 107,873 ->
    108,982 bytes (+1,109, +1.0281%)
  - group: 19,846 -> 19,846 tokens (0); 91,614 -> 91,614 bytes (0)
  - Captured fields were `include`, `input`, `parallel_tool_calls`, `text`,
    `tool_choice`, and `tools`; transport-only model, reasoning, stream, store,
    service-tier, prompt-cache, and client metadata were excluded identically.
    Codex home/workspace paths and UUIDs were normalized identically. The base
    direct fixture used the exact former default-off availability; group was
    captured independently and remained byte-identical.
