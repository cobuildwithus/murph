# Batch hosted group roster and newsletter reads

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Keep hosted group roster reads and newsletter preparation bounded as group
  membership grows by replacing per-member database/decrypt fanout with
  set-based reads, without weakening newsletter recipient or health-share
  authorization.

## Success criteria

- Newsletter preliminary participant facts use batched access/email reads and
  decrypt only verified email under one request-scoped root-unwrapping cache.
- Group roster reads batch member identities and decrypt only phone handles
  under one request-scoped root-unwrapping cache.
- Display-name preflight checks only group existence; the final post-update
  canonical group summary remains unchanged.
- The final newsletter `RepeatableRead` snapshot, proof comparison, send-time
  recipient revalidation, membership/grant rules, participant ordering,
  missing-email wake behavior, and retry/idempotency behavior remain covered.
- Focused tests assert bounded query/decrypt shape and authority behavior, and
  the required hosted-web verification, completion audit, CI, ReviewGPT, and
  mergeability gates pass.

## Scope

- In scope: hosted group newsletter participant preparation and recipient
  resolution; group roster identity projection; display-name existence
  preflight; narrow hosted-member email/identity batch read helpers; focused
  regression tests.
- Out of scope: removing the canonical newsletter reread, changing newsletter
  delivery or MIME behavior, changing grants/consent, schema changes, changing
  missing-email nudge routing, or adding cache/state owners.

## Constraints

- Technical constraints: preserve `RepeatableRead` and the exact late authority
  snapshot; use Prisma set-based reads; keep plaintext addresses and phone
  handles ephemeral; zeroize cached roots at the existing scoped-cache boundary.
- Product/process constraints: preserve visible-address shared-thread consent,
  health-share scope, group member order, first-send behavior, and all existing
  critical send/retry paths. Use the isolated PR worktree and finish through the
  repository's plan, audit, commit, CI, ReviewGPT, and mergeability workflow.

## Risks and mitigations

1. Risk: batching accidentally treats a stale email or inactive member as
   authorized.
   Mitigation: retain the final canonical `RepeatableRead` snapshot and compare
   the batched decrypted candidate to its canonical lookup identity/timestamp.
2. Risk: narrow decrypt helpers change field AAD or expose extra private fields.
   Mitigation: reuse the existing verified-email and phone field codecs, select
   only needed encrypted columns, and add decrypt-shape tests.
3. Risk: display-name optimization removes the final canonical response.
   Mitigation: replace only the provider-call preflight with an ID-only read and
   retain the existing post-update `readHostedGroupSummaryById` call.

## Tasks

1. [completed] Record baseline query/decrypt fanout and preserve authority/order
   invariants.
2. [completed] Add narrow batched verified-email and phone-handle read helpers.
3. [completed] Switch newsletter preliminary facts and roster projection to
   set-based reads.
4. [completed] Replace display-name full-summary preflight with an ID-only
   existence read.
5. [completed] Add focused bounded-query, narrow-decrypt, authority, ordering,
   and preflight regression tests.
6. [in progress] Run hosted-web verification, coverage-write, parent final
   review, finish-task, PR CI, ReviewGPT, and mergeability proof.

## Decisions

- Preserve both newsletter fact passes because the first owns best-effort
  missing-email nudge evaluation and the second is the post-nudge authorization
  result; make each pass bounded instead of collapsing their lifecycle.
- Keep batched private-field projection in the existing hosted member identity
  and email store owners; no new cache, service, or persisted state.

## Verification

- Commands to run: focused Vitest for hosted group newsletter/store/tool and new
  narrow store helper tests; `pnpm test:diff` for touched `apps/web` paths;
  `git diff --check`; required `coverage-write`; PR CI and ReviewGPT.
- Expected outcomes: focused behavior and query-shape tests pass, diff-aware
  hosted-web coverage passes, all audit findings are resolved, ReviewGPT returns
  `ROUND_OUTCOME: PASS`, CI is green, and the PR head merges cleanly with latest
  `origin/main`.
- Evidence so far:
  - Focused Vitest: 4 files and 200 tests passed.
  - Scoped ESLint: passed with no warnings or errors in changed files.
  - Hosted-web TypeScript check: passed.
  - `pnpm test:diff`: passed, including 5,212 web tests, lint, dev smoke, and
    the Next production build.
  - Independent `coverage-write`: passed with one added participant-backed
    thread-container access regression; final focused lane passed 201 tests.
  - Parent cross-lane review: passed with no accepted findings.
Completed: 2026-07-15
