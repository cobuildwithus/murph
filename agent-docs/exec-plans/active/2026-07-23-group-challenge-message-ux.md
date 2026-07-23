# Tighten group challenge messaging UX

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Make group-challenge setup and consent messaging feel like one natural
  conversation: ask the next setup question directly, use concrete Like
  language for challenge buy-in, and let Web's canonical permission card stand
  on its own without a redundant assistant announcement.

## Success criteria

- Linq/iMessage and Telegram group turns retain their existing optional
  multi-bubble rhythm.
- Challenge buy-in asks members to reply "in" or Like the message and never
  emits the vague phrase "react positively."
- Challenge kickoff asks the next unresolved question without a standalone
  setup-status preamble.
- A handled `post_join_offer` result never triggers a second member-facing
  announcement. When the server-owned card is the only useful outcome, Murph
  calls `finish_without_reply`.
- Model-authored group progress remains available but is reserved for genuinely
  long work, never routine challenge setup, permission offers, standings reads,
  or short tool sequences.
- The group-scoped progress tool description and system prompt carry the same
  sparse rule, while direct-chat progress guidance remains unchanged.
- A prior handled permission-offer action is keyed by exact participant and
  scope and never suppresses a newly affected participant.
- Focused prompt/skill tests, canonical diff verification, acceptance
  verification, required product/prompt/coverage reviews, and the final
  cross-cutting review pass.

## Scope

- In scope: group-challenge and group-chat skill guidance; group-channel
  progress prompt and dynamic-tool guidance; exact prompt/skill/planning
  regression tests; the group challenge diagnostics product contract.
- Out of scope: Web-owned permission-card copy and accepted reactions; challenge
  scoring, scheduling, consent state, group membership, and direct-message reply
  splitting.

## Constraints

- Technical constraints: preserve one canonical Web-owned consent card and the
  existing `post_join_offer` evidence/dedupe path; add no state or new delivery
  effect; keep direct-message prompt behavior unchanged.
- Product/process constraints: follow iMessage deliverability guidance, current
  GPT-5.6 prompt guidance, the isolated worktree/PR completion workflow, and
  privacy-safe artifacts. Preserve group `---` bubble support.

## Risks and mitigations

1. Risk: suppressing consent information instead of only suppressing duplicate
   narration.
   Mitigation: retain the complete server-authored card and its frozen scope,
   gesture, and customize-link semantics; change only the assistant follow-up.
2. Risk: a group-specific progress edit changes direct-chat behavior.
   Mitigation: branch only the progress wording on conversation scope and test
   group and direct inputs together.
3. Risk: concurrent prompt work overlaps `system-prompt.ts`.
   Mitigation: confine the edit to execution-behavior prompt selection, record
   the overlap, and reconcile against the latest base before final push.

## Tasks

1. Capture the current behavior and root cause in source, tool-result, prompt
   assembly, and durable-contract evidence.
2. Tighten the group-challenge and group-chat skills plus group progress prompt
   with exact, non-duplicative member-facing behavior.
3. Update focused regression tests and the durable diagnostics contract.
4. Run focused verification, product-experience review, the preliminary
   prompt/coverage specialist pass, parent review, and final cross-cutting
   review.
5. Run canonical final verification, close the plan, commit, push, and open the
   scoped PR.

## Decisions

- Keep Web's current "Like or heart" permission card unchanged. It is the
  consent surface and was not the UX defect; the redundant assistant-authored
  confirmation was.
- Preserve group `---` bubbles. They were not the cause of the screenshot; the
  defect was a server-owned card followed by redundant assistant narration.
- Keep `send_progress_update` available in groups, but give it a sparse
  group-specific system prompt and tool description: genuinely long work only,
  at most one update, and never routine challenge setup, permission offers,
  standings reads, or short tool sequences. System-owned context-compaction
  progress remains unchanged.
- Treat `post_join_offer: sent` as opaque because the scheduled adapter exposes
  only that handled status. Record a participant-and-scope handled action from
  the same `read_shared` evidence without claiming a card was visible.
- Preserve natural `---` bubbles inside one assistant response or dispatch;
  prohibit only separate status and permission-card companion follow-ups.

## Verification

- Commands to run: focused assistant-engine Vitest files; `pnpm test:diff` for
  the exact changed paths; `pnpm verify:acceptance`; clean-diff and privacy
  inspection; required review workflows and PR CI.
- Expected outcomes: all checks pass; Linq/Telegram group prompts retain
  multi-bubble guidance and expose sparse progress guidance; skill assets
  contain exact Like language, ask setup questions directly, and finish without
  reply instead of announcing a server-owned card.
- Current evidence:
  - Focused assistant-engine prompt, skill, planning, and model-behavior tests
    pass: 167 tests across eight files; assistant-engine typecheck also passes.
  - The complete Web group-tool test file passes all 79 tests, including the
    existing regression proving `status: sent` can accompany an all-granted
    result with no provider card send.
  - Local `test:diff` passed all affected typechecks, assistant-engine (2,604
    tests), and assistant-cli (128 tests). Its downstream assistant-runtime
    shard was blocked by an unrelated shared `/tmp` test vault containing a v2
    synthetic state file while this base expects v1.
  - A fresh Crabbox Testbox independently passed the affected typechecks,
    assistant-engine (2,604 tests), and assistant-runtime (1,801 tests),
    confirming the local runtime failure was environmental. The broad
    downstream CLI shard then hit unrelated command timeouts and existing
    experiment-fixture mismatches; the already-failed owned Testbox command was
    stopped rather than waiting through further timeout-only shards.
  - Required local product-experience review returned `NO FINDINGS`. It recorded
    the absence of a paid-model/live-Linq transcript as an evidence gap rather
    than treating prompt assertions as live-provider proof.
  - Preliminary GPT-5.6 Sol specialist review found three issues. The opaque
    `post_join_offer: sent` finding was accepted. The group progress and
    multi-bubble findings were subsequently narrowed by explicit product
    direction: bubbles remain supported and progress remains available with
    sparse group-specific guidance. The specialist returned no patch artifact.
  - Final local deep review found that the permission card could still receive
    a companion assistant confirmation and that the scheduled result strips
    grant metadata. Both were accepted: the skills now require
    `finish_without_reply` when the card is the sole outcome and use opaque
    handled-action bookkeeping. Its progress-delivery and low-usage bubble
    findings were not applied after explicit product direction preserved group
    progress and `---` bubbles.
  - The final rerun found three instruction conflicts: scope-wide handled-offer
    wording, stale "received an offer" tool copy, and an ambiguous one-message
    rule. All were accepted and corrected with exact participant-and-scope
    eligibility plus explicit support for `---` bubbles inside one response.
  - A product-experience rerun found that the generic progress tool description
    contradicted the sparse group system prompt. The group route now receives a
    matching group-specific tool description; the direct route remains
    unchanged.
