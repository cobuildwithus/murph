# Chat-first capability invariant

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make conversation Murph's primary operating surface by requiring routine
  user-facing capabilities to remain reachable through an assistant-callable
  CLI or typed tool, without creating a second state owner or duplicating UI
  logic.

## Success criteria

- The baseline invariant states an individually provable chat-reachability gate.
- Product Sense captures the 80–90% conversational-completion
  direction without demanding literal UI parity.
- The tone-and-voice spec truthfully identifies the current CLI/chat gap as
  follow-up rather than claiming end-to-end conversational completeness.
- The product-spec index reflects the partial tone/voice status.
- The durable docs index and touched-doc verification dates remain truthful.
- Narrow browser, operating-system, provider, authentication, consent, payment,
  and high-bandwidth interaction exceptions preserve safety and product sense.

## Scope

- In scope: text-only durable policy and current-state documentation for
  conversation-first capability reachability.
- Out of scope: implementing a tone/voice CLI command, changing web UI or
  runtime behavior, or inventorying every existing product capability.

## Constraints

- Technical constraints: preserve one canonical owner for each action; web,
  CLI, and assistant surfaces remain adapters over that owner.
- Product/process constraints: avoid absolute parity language; require an
  explicit narrow exception and smallest safe handoff when chat cannot finish
  an action.

## Risks and mitigations

1. Risk: The invariant forces unsafe or awkward chat replicas of browser-only
   ceremonies.
   Mitigation: Scope the gate to routine product actions and name narrow
   exceptions with handoff requirements.
2. Risk: The 80–90% aspiration becomes an unauditable slogan.
   Mitigation: Pair it with a per-feature proof gate: chat path or documented
   exception.
3. Risk: A CLI mirror becomes a second business-logic owner.
   Mitigation: Require both web and CLI/tool adapters to call the same owning
   domain primitive.

## Tasks

1. Confirm the existing command architecture and tone/voice reachability gap.
2. Draft and apply the baseline, product-target, current-spec, and index
   wording.
3. Read back the touched docs, inspect the scoped diff for privacy and
   consistency, run required verification, and finish with a scoped commit.

## Decisions

- Treat the CLI/tool path as the implementation seam that makes chat capable;
  do not require users to operate the CLI themselves.
- Treat visual presentation as distinct from product action parity.
- Keep the numeric coverage target in Product Sense and the per-feature hard
  gate in the baseline invariants.
- Permit only one owning mutation contract; any additional stored surface copy
  is downstream-only derived state, not a synchronized peer writer.

## Verification

- Touched-doc readback and independent policy review passed; review findings
  tightened the single-writer rule and corrected the current browser paths.
- `pnpm docs:drift` passed after the final wording changes.
- `pnpm typecheck` passed.
- `pnpm test` passed: 709 test files passed, 1 skipped; 8,569 tests passed,
  10 skipped.
- Scoped `git diff --check`, reference existence checks, and local-identifier
  privacy scans passed.
Completed: 2026-07-10
