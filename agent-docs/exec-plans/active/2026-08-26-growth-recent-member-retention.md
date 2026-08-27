# Add recent-member retention signals to Growth

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

Give authorized operators an immediately useful view of how the 20 newest real
members are using Murph today and across the rolling seven-day window, without
exposing conversation content or introducing a second analytics store.

## Product UX

Effort: Feature. This adds member-level usage meaning to the existing internal
Growth surface.

### Outcome

An authorized operator can scan the newest 20 real members, newest first, and
quickly distinguish activity today, earlier activity in the rolling seven-day
window, and no visible activity in that window using truthful receipt-time
evidence.

### Entry and promise

The operator enters through `/ops/growth`. The server-rendered page shows a
read-only recent-members section captured at the same instant as the rest of
the dashboard. Counts cover personal conversations only. `Today` uses the
current UTC day; `Last 7 days` is a rolling seven-day window ending at capture
time.

### Affected people and states

- An operator reviewing rich activity sees a masked member hint, signup age,
  onboarding and suspension state, message counts today and in the last seven
  days, plus the latest receipt inside that window.
- An operator reviewing a sparse or brand-new member sees explicit `No activity
  in 7d` wording instead of a lifetime claim that the retained source cannot
  prove.
- An operator on a narrow phone sees the recent-activity badge and Today and
  seven-day counts directly in compact member rows; desktop keeps all comparison
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
- No lifetime message count, first-ever receipt, return label, or plan label is
  inferred from retention-bounded mailbox rows or raw billing status.

### Product challenge and approval

The initial proposal risked turning one operator question into a wide generic
analytics table. The corrected scope keeps only evidence that explains recent
engagement, labels UTC and rolling-window semantics, and excludes speculative
scoring, private content, and claims the retained source cannot support. The
user approved the feature and explicitly authorized the worktree, branch, PR,
and ReviewGPT loop.

## Architecture

- Extend the existing Growth read owner with one ordered query for at most 20
  real members rather than adding a second analytics owner.
- Reuse the owner's existing rolling-seven-day and current-UTC-day personal
  mailbox groupings by selecting count and latest-receipt fields from those
  same operations; add no mailbox query for the section.
- Use `HostedMailboxItem.createdAt` for receipt-time semantics and
  `conversation.message` for inbound messaging, matching the Growth contract;
  keep every displayed activity fact inside the live seven-day window.
- Return only small serializable fields to a pure production component. Reuse
  that component with synthetic props in the existing Growth design study.
- Maximum incremental database work is one bounded member query; there is no
  per-member query or transaction.

## Tasks

1. Implement the bounded recent-member projection in the Growth read owner and
   add composed unit coverage.
2. Build the production section and its rich, sparse, and empty render tests.
3. Render the projection already returned by the Growth dashboard owner.
4. Add the production component to the existing Growth design study.
5. Run focused tests, Web typecheck/lint, design/browser proof, privacy review,
   exact-head CI, preliminary specialist ReviewGPT, and the final ReviewGPT
   gate required by the member-data boundary.
6. Resolve accepted findings, re-review changed candidate heads as required,
   and leave the PR with no unresolved actionable finding.

## Verification

- Product UX walkthrough: pass after remediation. ReviewGPT correctly identified
  that retention-bounded mailbox rows cannot support lifetime or return claims,
  and raw billing status cannot name Starter or Family plan context. The
  deletion-first correction keeps only today and rolling-seven-day activity and
  removes plan presentation. Refreshed desktop and phone browser proofs show all
  three recent-activity states without clipping or horizontal scrolling.
- Final ReviewGPT round 2 found that the standalone projection duplicated the
  Growth owner's existing today and seven-day mailbox reads. The accepted
  complexity-collapse correction folds the newest-20 projection into that owner
  and deletes both redundant mailbox operations. The composed focused test
  proves the new rows and unchanged active-user totals from the shared reads.
- `pnpm --dir apps/web test:prepared
  test/hosted-ops-recent-member-retention.test.tsx
  test/hosted-ops-growth.test.ts` — pass after owner collapse, 58 tests.
- Changed-file Web ESLint — pass.
- `pnpm --dir apps/web typecheck` — pass. This full command regenerated the
  ignored Health Commons and Prisma prerequisites before the checker.
- `pnpm test:frontend-design-proof` — pass, 12 tests.
- `pnpm docs:drift` and `git diff --check` — pass.
- Playwright proof at desktop and phone widths — pass, 2 tests after installing
  the repository-pinned Chromium; the test blocks non-loopback requests and uses
  only the synthetic Growth study.
- `pnpm test:diff <task paths>` — pass after remediation. The composed Web lane
  passed 800 test files / 11,183 tests, full lint with zero errors, isolated dev
  smoke, and the optimized Next.js production build, plus the repository architecture,
  privacy, dependency, and workspace-boundary guards.
- Exact pushed-head CI passed for the first candidate except the separately
  pending native mobile E2Es. Final ReviewGPT rounds 1 and 2 returned accepted
  findings; the newest-owner correction, refreshed evidence, CI, and final
  round 3 remain.
