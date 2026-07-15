# PR 626 Same-Wake Batching E2E

## Goal

Prove that rapid replyable Linq messages exposed by one hosted wake are processed as one ordered assistant turn, including the empty-selection pre-scan race, and close modern and legacy terminal-evidence recovery gaps exposed by compound input groups.

## Constraints

- Preserve the existing same-conversation, same-reply-anchor, exact-successor batching boundary.
- Allow the required pre-scan refresh to acquire the same bounded batch only
  while selection is empty; freeze it as soon as it becomes nonempty.
- Leave causal gaps, legacy sequences, overflow, and post-freeze arrivals pending.
- Use the production hosted-local runtime path without test-only batching controls.
- Keep the new scenario in an existing CI matrix leg.
- Reset the runner static-closure ratchet only to the exact measured build
  after the intentional boot-path growth; keep its tolerance and total ceiling.
- Preserve unrelated working-tree and coordination-ledger changes.

## Plan

1. Compare current selection semantics with the pre-regression implementation and introducing commit.
2. Trace foreground, background, empty-selection refresh, accepted-input, and terminal-evidence recovery paths.
3. Add a repeated same-wake hosted-local E2E with exact provider-request and reply assertions.
4. Wire the scenario into the harness registry, aggregate suite, CI, and verification docs.
5. Run focused TypeScript 7 checks, unit suites, the direct hosted E2E, diff-aware verification, and final audits.
6. Close local plan state, push the exact PR head, and complete the required ReviewGPT and CI gates.

## Verification

- Assistant-runtime, assistant-engine, and hosted-local-harness package `test:coverage` scripts.
- Assistant-runtime, assistant-engine, and hosted-local-harness package `typecheck` scripts through the TypeScript 7 wrapper.
- Exact post-rebase owner suites: assistant-engine active-turn/automation tests and assistant-runtime turn-input/maintenance/workspace-entrypoint tests.
- `pnpm --dir apps/cloudflare runner:bundle:hosted-local` with the canonical entry, static-closure, and total budgets.
- `pnpm hosted-local e2e linq-lost-active-operation linq-same-wake-batching --no-bundle`.
- Focused ReviewGPT packaging/policy tests and `pnpm docs:drift`.
- Shell syntax checks for the review packager/preflight and `git diff --check`.
- The shared-host `pnpm test:diff ...` attempt was blocked by an unrelated latest-main wrapper fixture that inherited the held-slot marker; full owner coverage and focused exact-head suites are the truthful local substitute, with PR CI authoritative for the final head.

## State

Implementation and local verification are complete. Historical comparison proves
that the singleton regression was introduced after the prior batching behavior;
the restored selector deliberately adds exact-successor, conversation,
reply-anchor, legacy, and 50-input safety boundaries. Coverage-write found no
missing owner-level proof. Full package coverage passed for assistant-runtime,
assistant-engine, and hosted-local-harness, and the exact final tree passed 174
engine tests, 298 runtime tests, all three TypeScript 7 package checks, ReviewGPT
policy tests, docs drift, shell syntax, and diff checks. The final runner bundle
measured 1,467,813 B entry, 7,149,982 B static closure, and 8,840,489 B total,
within every budget. Both the latest-main late-active-turn E2E and the repeated
same-wake batching E2E passed on that bundle. The rebase onto current `main` is
patch-identical by range-diff; its ancestry-only merge preserves prior ReviewGPT
lineage without a tree change. ReviewGPT and final-head CI remain as post-push PR
gates.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
