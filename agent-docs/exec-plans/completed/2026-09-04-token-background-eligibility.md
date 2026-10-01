# Avoid empty background model work and verify scheduled Flex routing

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Avoid model work for background occurrences whose existing authoritative evidence proves no useful work, while preserving timely personal support and scheduled Flex routing.

## Success criteria

- Empty maintenance windows skip before provider admission; collection failures are never classified as empty.
- Existing group pages and all nonempty evidence, including corrections and late committed reactions, remain eligible.
- Journal and Personal Patterns first scheduled attempts request Flex when their provider supports it; retry and exact-time delivery policies remain unchanged.
- Focused deterministic checks, typecheck, synthetic live outcome proof, parent review, draft PR, and eligible external review complete.

## Scope

- In scope: existing maintenance evidence/notification and canonical cron precondition owners; narrow Journal eligibility only when existing account and ledger state prove absence of work; exact managed-seed Flex regression coverage.
- Out of scope: new schedulers, persistent evidence cursors, model downgrades, skill restructuring, production mutations, deployment, merge.

## Constraints

- Technical constraints: derive from current owners without new state. Preserve bounded evidence, owned cancellation, scheduler occurrence consumption, and provider admission replay barriers.
- Product/process constraints: internal efficiency patch. Member/group support, notice delivery, corrections, forget requests, existing-page cleanup, due follow-ups, and failures keep their current behavior.

## Risks and mitigations

1. Risk: treating unavailable or old-looking evidence as no work loses useful maintenance.
   Mitigation: explicit collection status, no timestamp cursor, and no skip for a present group page.
2. Risk: disconnected accounts still have Journal follow-up obligations.
   Mitigation: retain model eligibility whenever the existing ledger is present or unreadable.

## Tasks

1. Trace current evidence, cron authority, and Flex selection; prove the safe no-op cases.
2. Add typed evidence status and narrow provider-free skips at existing boundaries.
3. Add focused empty/error/present-page/nonempty evidence and managed Flex regressions.
4. Run focused tests/typecheck and production-derived synthetic model journey; inspect privacy and complexity.
5. Parent candidate review, draft PR, readiness, concurrent ReviewGPT/CI, and completion evidence.

## Decisions

- Repeated seven-day windows are retained: timestamp-only watermarks cannot safely cover late events and corrections, and new durable digest state is unnecessary for the proven empty-window fix.
- Preserve existing group-page maintenance even with no new conversation; its owner may compact/prune existing content.
- Personal Patterns vocabulary normalization and notification-ledger updates are useful silent work, so an absence of newly sendable results alone never grants host skip authority.

## Verification

- Commands to run: focused assistant-engine Vitest files; assistant-engine typecheck; one focused production-derived live journey; complexity diff and doc checks.
- Expected outcomes: zero provider calls for proven no-op; normal model work for uncertain/nonempty evidence; exact Flex/Standard contract for managed scheduled families; no outbound messages from silent maintenance.

## Progress and evidence

- Implemented typed maintenance evidence status and provider-free empty admission. Existing group pages, unavailable evidence, and nonempty corrections/reactions retain normal work.
- Implemented Journal precondition requiring exact managed id, absent ledger, and complete empty connected-account inventory. Existing ledger/error/account cases remain eligible. Composio rejects malformed pages rather than hiding them as an empty inventory.
- No Flex route fix was needed: production seed integration and provider boundary tests prove Journal morning/afternoon and Personal Patterns already request Flex when supported, then retry a failed occurrence on Standard after 30 seconds.
- Passed: 107 maintenance/evidence/notification tests; 50 selected cron lifecycle/onboarding/eligibility tests; 20 Journal gate tests; 19 Composio tests; 3 Flex provider-boundary tests; 9 changelog rendering tests.
- Engine and Web typechecks passed. Fresh Web preparation required the canonical device-syncd package build; the task-owned Frog entry records the missing declared artifact prerequisite.
- Complexity and docs drift passed. Existing cron maximum decreased from 127 to 124; notification maximum decreased from 73 to 69. Other affected-file hotspots remain unchanged.
- Live production-derived synthetic memory-correction journey passed on Terra via local subscription: exactly one show and one versioned update, the intended record corrected among 24, exact skip decision, no message. UX verdict: Ready. PR #2848 is Ready. Parent candidate and final source review passed; no accepted/actionable findings remain.

- Final ReviewGPT round 1 passed on candidate `c02ce530dc8e5bc668823676111cc330f35ee2f3`: full sensitive snapshot, verified gpt-6-pro model and exact response/user-turn identity, 9 minutes 22 seconds from send to capture. No qualifying findings.
- Tooling retries did not consume substantive rounds: an inherited attachment-staging failure, one diagnostic PASS below the review trust floor, and one pre-send Chat-surface failure. No candidate code changed during review recovery.
- Required CI passed on the reviewed candidate, including release checks, assistant-engine coverage, Web build/tests, and Temporal compatibility. Current-base merge-tree proof passed. The explanatory plan-closeout commit requires final-head CI before PR handoff; no further substantive review is required.
- No merge or deployment performed. Preserve the open PR worktree.
Completed: 2026-09-04
