# Batch Linq egress mailbox authority reads

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Keep Linq runtime reply authority checks exact while replacing per-candidate
  mailbox and payload reads with bounded batch reads inside the existing locked
  engagement transaction.

## Success criteria

- Answered mailbox ids retain reverse-input priority and recent mailbox rows
  retain descending lane-sequence priority.
- Cross-member, non-conversation, non-direct, wrong-target, wrong-message, and
  malformed payload evidence remains unauthorized.
- Up to 100 answered ids plus 100 recent rows use a constant number of mailbox
  item/payload queries and one scoped ingress-root unwrap instead of per-row
  database/KMS work.
- Focused regression/query-count coverage and the required hosted-web
  verification, coverage audit, PR ReviewGPT loop, CI, and mergeability proof
  all pass.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/linq-egress-engagement.ts`
  - `apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts`
- Out of scope:
  - Hosted mailbox schema, store ownership, retention policy, and wire format.
  - Engagement route locking, provider-dispatch claim semantics, or authority
    policy changes.

## Constraints

- Technical constraints:
  - Preserve the current 100 answered-id and 100 recent-row bounds.
  - Preserve live-row retention/expiry filtering and sidecar ref binding.
  - Reuse the already-fetched mailbox rows; do not reread them per sidecar.
  - Keep decoding ordered and short-circuit on the first exact match.
- Product/process constraints:
  - Avoid `apps/web/src/lib/hosted-mailbox/store.ts`, which overlaps the active
    mailbox consumed-at lane.
  - Use the isolated task branch, scoped plan/ledger closure, PR-lane
    ReviewGPT, and no local deep-review.

## Risks and mitigations

1. Risk: batching changes candidate precedence or dedupe behavior.
   Mitigation: build maps only for query reuse, then iterate the original
   answered-reverse and recent-desc candidate sequence unchanged.
2. Risk: broader batch reads expose or decrypt another member's evidence.
   Mitigation: keep live/member/kind/lane checks before sidecar selection and
   decode, and query sidecars only for already-authorized candidate rows.
3. Risk: a retention or payload-ref mismatch becomes authority.
   Mitigation: mirror the mailbox live predicate at the query boundary and
   retain exact payload-ref-to-item binding before the sidecar query.

## Tasks

1. Add bounded local Prisma batch readers and ordered candidate assembly.
2. Decode the batch under one scoped hosted-domain root unwrap cache while
   preserving all existing authority comparisons.
3. Add behavior and constant-query-count regressions for the full 200-candidate
   bound, sidecars, ordering, and invalid evidence.
4. Run focused checks, full acceptance, coverage-write, parent final review,
   plan closure, push/PR, ReviewGPT with CI, and mergeability proof.

## Decisions

- Keep the batch projection local to the Linq engagement owner to avoid the
  active mailbox-store lane; do not introduce a generic mailbox batching API.
- Use explicit Prisma `findMany` calls rather than relation `include` so the
  query bound is visible and testable.

## Verification

- Focused hosted-web Vitest passed with 32 tests after rebasing onto the latest
  `origin/main`.
- The truthful owner lane passed twice with conservative worker caps:
  `pnpm test:diff apps/web/src/lib/hosted-onboarding/linq-egress-engagement.ts apps/web/test/hosted-onboarding-linq-egress-engagement.test.ts`.
  The final coverage-write run passed 5,212 tests with 141 skipped, plus web
  typecheck, lint, build, and dev smoke.
- The 200-candidate regression proves two mailbox-item queries, one sidecar
  query, one unwrap-cache scope, answered-reverse/recent-desc ordering, and
  reuse of every prefetched sidecar ciphertext.
- Boundary proof covers the shared live-row predicate, malformed payload refs,
  and foreign-member rows. `git diff --check`, scoped ESLint, and the
  identifier/secret-safe parent diff review passed.

## Completion audits

- `coverage-write` added the missing live-predicate and malformed/foreign-ref
  proof, reran the owner verification lane, and reported no unresolved
  actionable coverage findings.
- Parent final review preserved route locks, authority comparisons, retention,
  payload-ref binding, candidate priority, and fail-closed foreign evidence.
- The PR-lane ReviewGPT gate, CI, and mergeability proof remain post-push steps.
Completed: 2026-07-15
