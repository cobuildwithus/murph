# PR 511 ReviewGPT Round 13 Fixes

## Goal

Resolve both accepted ReviewGPT round-thirteen findings for PR 511:

1. Keep accepted, nonterminal conversation mailbox rows readable and retained
   beyond the generic age window until the existing conversation consumed floor
   or row disposition proves terminal handling.
2. Require current active access for every non-replay mailbox metadata and
   payload fetch so historical allowance is usable only through exact replay
   authority bound to the invocation fence.

## Constraints

- Reuse the mailbox row, `consumed_at`, and lane `consumed_seq`; add no queue,
  replay ledger, lifecycle owner, or compatibility state.
- Preserve ordinary age-based retention for non-conversation work and terminal
  conversation work.
- Do not let a default invocation batch rows under accepted-work authority.
- Preserve exact replay suspension, allowance-period, provider-egress, and
  usage-recording checks.

## Working Set

- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/src/lib/hosted-retention/cleanup.ts`
- hosted mailbox fetch and payload routes
- focused hosted mailbox, retention, and internal-route tests
- `agent-docs/references/hosted-runtime-protocol.md`

## Verification Plan

- Add production-query coverage proving old nonterminal conversations remain
  readable and undeleted, then become prunable after terminal disposition.
- Add route coverage proving non-replay conversation metadata and payload fetch
  fail after access revocation while exact replay remains admitted.
- Run focused tests and web typecheck, required completion audits, diff-aware
  verification, scoped commit and push, then repeat exact-head ReviewGPT until
  no actionable findings remain.

## Verification Results

- Focused mailbox/retention/internal-route suite: 99 tests passed.
- Hosted web typecheck: passed.
- Diff-aware workspace verification: passed, including boundary and dependency
  guards, hosted runtime architecture guards, lint with no errors, 4,383 web
  tests (137 skipped), dev smoke, TypeScript, and the production build.
- Coverage-write audit: two focused store assertions added; no unresolved gap.
- Security/privacy audit: zero Critical, High, or Medium findings; focused web
  and Cloudflare replay-authority suites passed.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
