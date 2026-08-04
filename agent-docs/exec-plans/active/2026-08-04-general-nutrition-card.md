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

- Ordinary private-direct interactive turns receive
  `murph.attach_response_card` without requiring the automatic meal-closeout
  automation id; unrelated scheduled turns remain closed.
- Group, maintenance, output-only, and native-capability-restricted turns keep
  their existing closed tool surfaces.
- The model-facing contract requires an immediately preceding single-date
  canonical meal-totals read and permits on-demand member requests as well as
  the existing managed closeout.
- The existing response-card schema, media conflict, outbox identity,
  capability fallback, and delivery behavior remain unchanged.
- Card attachment is limited to requests the whole-response card completely
  satisfies; compound requests retain their complete ordinary text response.
- Focused route-planning and tool-contract tests prove the new availability
  boundary and the unchanged private-direct restriction.

## Scope

- Replace the scheduled-only condition with the existing ordinary-inbound
  boundary plus the exact managed-closeout authority.
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
4. [x] Push the candidate, open the draft PR, and run preliminary specialist
   and final ReviewGPT concurrently with exact-head CI.
5. [ ] Resolve accepted findings, complete parent review, close this plan, and
   prove final mergeability.

## Verification log

- Focused route-planning and response-card tool tests: 77 passed after review
  remediation.
- Existing singular response-card runtime and notification/outbox delivery
  scenarios: 2 passed.
- Assistant Engine typecheck: passed.
- `git diff --check`: passed.
- Pinned Codex App Server plus local scripted Responses capture, model
  `gpt-5.6-terra`, low reasoning, code mode, and `gpt-tokenizer` 3.4.0
  `o200k_base`:
  - individual: 23,508 -> 23,798 tokens (+290, +1.2336%); 107,873 ->
    109,221 bytes (+1,348, +1.2496%)
  - group: 19,846 -> 19,846 tokens (0); 91,614 -> 91,614 bytes (0)
  - Captured fields were `include`, `input`, `parallel_tool_calls`, `text`,
    `tool_choice`, and `tools`; transport-only model, reasoning, stream, store,
    service-tier, prompt-cache, and client metadata were excluded identically.
    Codex home/workspace paths and UUIDs were normalized identically. The base
    direct fixture used the exact former default-off availability; group was
    captured independently and remained byte-identical.
- Exact candidate-head GitHub Actions: all required checks passed.
- Preliminary ReviewGPT returned two findings. The unrelated-scheduled-turn
  authority finding was accepted and fixed. Its requested credentialed live
  model-selection proof is retained as an explicit evidence gap because no
  supported provider credential is configured locally; the changed route and
  contract plus the existing effect/delivery owners have deterministic proof.
- Final ReviewGPT round 1 returned one material whole-response finding. The
  scheduled surface was narrowed, and the tool contract now limits attachment
  to requests the card alone completely satisfies so compound requests keep
  their complete ordinary text response.
- Corrected-head product-experience revalidation: `NO FINDINGS`. The smallest
  complete journey remains one explicit private request, one fresh canonical
  read, and one existing card/fallback effect in the same thread. The material
  evidence gap is live nondeterministic model selection and physical delivery;
  renderer and delivery code are unchanged.
