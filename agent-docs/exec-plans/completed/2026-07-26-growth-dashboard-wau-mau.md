# Growth dashboard WAU and MAU

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Show rolling weekly and monthly active conversation counts on the hosted growth dashboard across personal Murph chats and group-chat containers.

## Success criteria

- WAU counts each personal account or group container once when it received at least one inbound conversation message in the trailing seven days.
- MAU applies the same definition over the trailing thirty days.
- The scorecard labels the metric as active conversations rather than unique people and retains the prior-seven-day WAU comparison.
- The real scorecard component and its design study render the new values clearly on desktop and mobile.
- Focused tests, canonical verification, browser proof, and required completion reviews pass.

## Scope

- In scope: hosted growth query, growth scorecard presentation, existing growth scorecard design study, focused tests.
- Out of scope: decrypting or identifying individual group-chat senders, historical aggregates, schema changes, public analytics, and other ops dashboards.

## Constraints

- Count distinct mailbox `userId` values only; this is the shared identity for personal and synthetic group conversation containers.
- Do not describe the metric as unique humans because group message sender identity is encrypted and randomized.
- Keep the query and presentation within the existing growth dashboard ownership path.

## Risks and mitigations

1. Risk: group chats inflate a metric labeled as members or people.
   Mitigation: rename the data and UI to active conversations and explain that it covers personal and group chats.
2. Risk: repeated messages inflate activity.
   Mitigation: group mailbox rows by `userId` and count each conversation container once per window.
3. Risk: WAU and MAU use inconsistent time boundaries.
   Mitigation: use rolling windows ending at the same captured `now` value and assert exact query boundaries.

## Tasks

1. Replace direct-member activity counts with distinct active conversation-container rows for rolling 7-, prior-7-, and 30-day windows.
2. Add WAU and MAU counts to the growth scorecard while preserving the WAU week-over-week context.
3. Update the existing design study and focused regression coverage.
4. Run canonical verification, responsive browser proof, and required product/ReviewGPT reviews.
5. Commit, push, open the PR, verify CI and mergeability, and close the plan for handoff.

## Decisions

- Use `HostedMailboxItem.userId` as the conversation-container identity because both direct and group inbound messages are persisted against that owner.
- Keep WAU as the primary active-usage number and MAU as its supporting context in the existing scorecard signal.

## Verification

- Focused growth suite: 23 tests passed.
- Hosted-web typecheck and scoped ESLint passed.
- Canonical `pnpm test:diff` passed in one-shot Blacksmith Testbox `tbx_01kygpnd4awnd2grg8xvm19tbw`, including the hosted-web build, lint, typecheck, development smoke, and test suite.
- Playwright rendered the real design study at 1440x1200 and 390x844. DOM checks confirmed the document and study had no horizontal overflow and both ordinary and no-prior-baseline WAU/MAU states were present.
- Product-experience review returned `NO FINDINGS`.
- The Claude Fable UI double-check was attempted and stopped at explicit usage-credit exhaustion.
- The preliminary specialist pass first returned `INVALID` because the ordinary captures cropped out the separate no-prior-baseline state. Dedicated desktop/mobile captures and direct overflow/text proof closed that evidence gap; the unchanged-head retry returned `SPECIALIST_OUTCOME: PASS` with no findings and no patch artifact.
- Parent final review found no remaining correctness, scope, or proof gaps.
- Canonical `pnpm verify:acceptance` passed in one-shot Blacksmith Testbox `tbx_01kygrc0ykggzv0ntm6mj5zr1z`.
- Reviewer-readable Cloudflare Images hosting is blocked because the required least-privilege upload variables are unavailable. Redacted captures remain in the ignored review-evidence path for exact-head specialist packaging.
Completed: 2026-07-26
