# Pending attachment progress handling

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Let Murph acknowledge an attachment immediately, keep the Codex turn active
  while projection hydrates, and inspect the readable evidence before giving a
  substantive answer.

## Success criteria

- Pending attachment context directs Murph to send at most one visible progress
  update, continue the same turn, and avoid claims or escalation from metadata
  alone.
- Completed, failed, quarantined, not-attempted, and text-only prompt behavior
  remain unchanged.
- Focused prompt-builder tests and direct assembled-prompt readback pass.
- Product-experience, prompt, and coverage lenses complete with no unresolved
  accepted finding; exact-head CI and mergeability are green.

## Scope

- In scope: the pending attachment projection note and focused prompt regression
  proof.
- Out of scope: mailbox selection, projection state, queues, polling owners,
  persisted state, delivery machinery, and provider/runtime lifecycle changes.

## Constraints

- Preserve immediate text-only replies and the existing stage-time handoff to
  Codex.
- Reuse `murph.send_progress_update`; add no tool, service, state machine,
  scheduler, dependency, or runtime branch.
- Keep the instruction concise, outcome-first, and safe for direct and group
  conversations without prescribing exact outbound copy.
- Do not claim attachment inspection until readable evidence exists.

## Risks and mitigations

1. Risk: Murph treats the progress update as a final answer.
   Mitigation: state explicitly that it must continue the turn and not finalize
   while the attachment-dependent work is pending.
2. Risk: the new wording causes repeated status messages.
   Mitigation: reuse the existing at-most-one progress tool contract.
3. Risk: the prompt implies availability or successful extraction before proof.
   Mitigation: require readable evidence and inspection before substantive
   claims; retain existing terminal unavailable behavior.

## Tasks

1. Update the pending projection guidance at the prompt-builder owner.
2. Add focused prompt regression assertions for progress, continuation, and the
   no-premature-final contract.
3. Run focused tests and direct assembled-prompt readback.
4. Complete the exact-head preliminary specialist review, CI, parent final
   review, plan closure, and PR mergeability proof.

## Decisions

- Treat this as prompt-primary product behavior with product-experience, prompt,
  and coverage lenses in the preliminary specialist ReviewGPT pass.
- Keep runtime data flow unchanged; evaluate stronger runtime gating only if
  production evidence shows the prompt contract is insufficient.

## Verification

- `pnpm exec vitest run packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts --no-coverage`
- Direct readback of a descriptor-only `projectionStatus: "pending"` prompt.
- Pinned Codex App Server complete first-request capture with synthetic direct
  and group PDF fixtures, `gpt-5.6-terra`, low reasoning, code mode, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`: direct 30,667 to 30,706 tokens and
  140,486 to 140,684 bytes (+39 tokens, +0.1272%, +198 bytes); group 26,919
  to 26,958 tokens and 124,005 to 124,203 bytes (+39 tokens, +0.1449%, +198
  bytes). The complete provider-visible fields were `include`, `input`,
  `parallel_tool_calls`, `text`, and `tool_choice`; only transport controls were
  excluded identically. The temporary capture harness was removed.
- `git diff --check`
