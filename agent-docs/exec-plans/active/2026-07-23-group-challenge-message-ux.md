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

- Linq/iMessage and Telegram group turns have one assistant-authored delivery
  message, while direct conversations retain the existing optional multi-bubble
  rhythm.
- Challenge buy-in asks members to reply "in" or Like the message and never
  emits the vague phrase "react positively."
- Challenge kickoff asks the next unresolved question without a standalone
  setup-status preamble.
- A successful or already-active `post_join_offer` result records the offered
  scopes but does not trigger a second member-facing announcement.
- Focused prompt/skill tests, canonical diff verification, acceptance
  verification, required product/prompt/coverage reviews, and the final
  cross-cutting review pass.

## Scope

- In scope: group-challenge and group-chat skill guidance; group-channel
  reply-shape guidance; exact prompt/skill regression tests; the group
  challenge diagnostics product contract.
- Out of scope: Web-owned permission-card copy and accepted reactions; challenge
  scoring, scheduling, consent state, group membership, and direct-message reply
  splitting.

## Constraints

- Technical constraints: preserve one canonical Web-owned consent card and the
  existing `post_join_offer` evidence/dedupe path; add no state or new delivery
  effect; keep direct-message prompt behavior unchanged.
- Product/process constraints: follow the single-message group invariant,
  iMessage deliverability guidance, current GPT-5.6 prompt guidance, isolated
  worktree/PR completion workflow, and privacy-safe artifacts.

## Risks and mitigations

1. Risk: suppressing consent information instead of only suppressing duplicate
   narration.
   Mitigation: retain the complete server-authored card and its frozen scope,
   gesture, and customize-link semantics; change only the assistant follow-up.
2. Risk: a group-specific prompt edit changes direct-chat texting behavior.
   Mitigation: branch explicitly on conversation scope and test group and
   direct inputs together.
3. Risk: concurrent prompt work overlaps `system-prompt.ts`.
   Mitigation: confine the edit to `buildAssistantEvidenceAndReplyStyleText`
   and its call site, record the overlap, and reconcile against the latest base
   before final push.

## Tasks

1. Capture the current behavior and root cause in source, tool-result, prompt
   assembly, and durable-contract evidence.
2. Tighten the group-challenge skill and group reply-shape prompt with exact,
   non-duplicative member-facing behavior.
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
- Make the one-message rule explicit in the assembled group prompt because the
  generic developer-level multi-bubble guidance otherwise conflicts with the
  skill-level group rule.

## Verification

- Commands to run: focused assistant-engine Vitest files; `pnpm test:diff` for
  the exact changed paths; `pnpm verify:acceptance`; clean-diff and privacy
  inspection; required review workflows and PR CI.
- Expected outcomes: all checks pass; direct Linq/Telegram prompts retain
  multi-bubble guidance; group Linq/Telegram prompts require one message; skill
  assets contain exact Like language and prohibit redundant card announcements.
- Current evidence:
  - Focused assistant-engine prompt and skill tests pass: 45 tests across five
    files.
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
