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
  `gpt-tokenizer` 3.4.0 `o200k_harmony`: direct 30,679 to 30,772 tokens and
  140,479 to 140,917 bytes (+93 tokens, +0.3031%, +438 bytes); group 26,931
  to 27,024 tokens and 123,998 to 124,436 bytes (+93 tokens, +0.3453%, +438
  bytes). The complete provider-visible fields were `include`, `input`,
  `parallel_tool_calls`, `text`, and `tool_choice`; only transport controls were
  excluded identically. The temporary capture harness was removed.
- `git diff --check`

## Preliminary specialist disposition

- Accepted the prompt-level tool/stop-rule finding. Progress delivery is now
  conditional on tool availability; the same turn uses existing local shell
  access to check `raw/inbox/**` for a new descriptor-matching file for at most
  30 seconds, rejects stale or unrelated files, and falls back truthfully.
- Did not accept the proposed runtime admission gate or its runtime-integration
  coverage expansion. Those suggestions would replace the explicitly selected
  prompt-primary, best-effort behavior with new selection/wake behavior outside
  this task. The PR does not claim prompt wording makes projection readiness a
  runtime guarantee; stronger gating remains a separate product decision.
- No coverage patch artifact was supplied.
