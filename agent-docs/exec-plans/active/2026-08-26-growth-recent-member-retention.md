# Add recent-member retention signals to Growth

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

Give authorized operators an immediately useful view of how the 20 newest real
members are activating and returning to Murph, without exposing conversation
content or introducing a second analytics store.

## Product UX

Effort: Feature. This adds member-level usage meaning to the existing internal
Growth surface.

### Outcome

An authorized operator can scan the newest 20 real members, newest first, and
quickly distinguish no-message, first-day activation, and later-day return
behavior using truthful receipt-time evidence.

### Entry and promise

The operator enters through `/ops/growth`. The server-rendered page shows a
read-only recent-members section captured at the same instant as the rest of
the dashboard. Counts cover personal conversations only. `Today` uses the
current UTC day; `Last 7 days` is a rolling seven-day window ending at capture
time.

### Affected people and states

- An operator reviewing rich activity sees a masked member hint, signup age,
  onboarding and billing state, message counts today, in the last seven days,
  and all time, plus first and latest receipt timing.
- An operator reviewing a sparse or brand-new member sees an explicit
  `No message yet` state instead of zeros that imply activation.
- An operator on a narrow phone sees lifecycle and Today, seven-day, and
  all-time counts directly in compact member rows; desktop keeps all comparison
  columns visible in one table.
- A member with no masked phone hint remains distinguishable through a short
  opaque member-id suffix; no raw phone, email, message content, health data,
  or decrypted identifier is selected or rendered.
- If no real members exist, the section explains that there are no recent
  signups rather than rendering an empty table.

### Deliberate exclusions

- No churn prediction, retention score, automated follow-up, filters, actions,
  device/health facts, message contents, or new persistence.
- Group runtime and thread-container identities are excluded because they are
  not member signups. Per-participant group activity remains outside the table
  because the existing group analytics identity is explicitly not display
  data.
- `Returned` is descriptive only: at least one durable inbound message receipt
  occurred on a UTC calendar day after signup. It is not a cohort forecast.

### Product challenge and approval

The initial proposal risked turning one operator question into a wide generic
analytics table. The approved scope keeps only evidence that explains early
activation and return behavior, labels UTC and rolling-window semantics, and
excludes speculative scoring and private content. The user approved this scope
and explicitly authorized the worktree, branch, PR, and ReviewGPT loop.

## Architecture

- Add one focused server-only read model beside the existing Growth aggregate
  owner rather than expanding the already broad aggregate dashboard type.
- Read at most 20 real members in one ordered query. For those IDs only, issue
  three independent set-based mailbox aggregates in parallel: all-time
  first/latest/count, rolling seven-day count, and current-UTC-day count.
- Use `HostedMailboxItem.createdAt` for durable receipt-time semantics and
  `conversation.message` for inbound messaging, matching the Growth contract.
- Return only small serializable fields to a pure production component. Reuse
  that component with synthetic props in the existing Growth design study.
- Maximum database work is four round trips and 20 aggregate output groups per
  mailbox query; there is no per-member query or transaction.

## Tasks

1. Implement the bounded recent-member read model and unit coverage.
2. Build the production section and its rich, sparse, and empty render tests.
3. Wire the read into `/ops/growth` in parallel with existing independent reads.
4. Add the production component to the existing Growth design study.
5. Run focused tests, Web typecheck/lint, design/browser proof, privacy review,
   exact-head CI, preliminary specialist ReviewGPT, and the final ReviewGPT
   gate required by the member-data boundary.
6. Resolve accepted findings, re-review changed candidate heads as required,
   and leave the PR with no unresolved actionable finding.

## Verification

- Product UX walkthrough: Ready. Desktop exposes the full comparison table;
  phone renders compact member rows with lifecycle and all three counts before
  timing details; rich, sparse, no-message, and empty states are represented by
  synthetic data. The shipped scope matches the approved plan.
- `pnpm --dir apps/web test:prepared
  test/hosted-ops-recent-member-retention.test.tsx
  test/hosted-ops-growth.test.ts` — pass, 60 tests.
- Changed-file Web ESLint — pass.
- `pnpm --dir apps/web typecheck` — pass. This full command regenerated the
  ignored Health Commons and Prisma prerequisites before the checker.
- `pnpm test:frontend-design-proof` — pass, 12 tests.
- `pnpm docs:drift` and `git diff --check` — pass.
- Playwright proof at 1440x900 and 390x844 — pass, 2 tests; the test blocks
  non-loopback requests and uses only the synthetic Growth study.
- `pnpm test:diff <task paths>` — pass. The composed Web lane passed 800 test
  files / 11,185 tests, full lint with zero errors, isolated dev smoke, and the
  optimized Next.js production build, plus the repository architecture,
  privacy, dependency, and workspace-boundary guards.
- Exact pushed-head CI and both ReviewGPT stages remain pending until the
  review candidate is committed, pushed, and described in its PR.
