# Pending-group payload crypto boundary

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Preserve pending group setup intent across provider, KMS, root lookup,
  secure-box parsing, and authentication failures while keeping authenticated
  malformed application payloads from blocking future group admission.
- Move every provider-capable payload-root preparation step before the route
  transaction and bind in-transaction use to the exact locked row.

## Success criteria

- The pre-transaction preparation phase reads and warms the exact candidate
  payload root with bounded work.
- The transaction repeats candidate selection and authority checks, locks the
  winner, and accepts prepared state only when candidate id, owner, recipient
  line, ciphertext, and root reference still match.
- Missing or stale preparation and every crypto/provider failure throw so the
  transaction rolls back without deleting the pending row.
- Only plaintext that was successfully authenticated but fails JSON/envelope
  schema parsing deletes the exact locked row and returns `invalid_payload`.
- Focused tests prove row preservation, malformed-payload retirement, stale
  preparation retry behavior, and the absence of provider-capable work inside
  the transaction.

## Scope

- In scope: pending-group payload preparation/claim code, the existing Linq
  route preparation handoff, focused unit and PostgreSQL concurrency proof,
  and the matching reliability contract.
- Out of scope: changing pending-group selection policy, group-route ownership,
  secure-box wire formats, KMS providers, or unrelated mailbox crypto paths.

## Constraints

- Keep the existing bounded two-attempt prepared-transaction retry owner.
- Reuse the request-scoped root cache and secure-box envelope/root helpers.
- Do not allow stale preparation to authorize a changed row or decrypt changed
  ciphertext.
- Do not consume rows on unauthenticated, infrastructure, or unavailable-root
  failures.

## Risks and mitigations

1. Risk: a winner changes between preparation and row lock.
   Mitigation: bind preparation to exact row fields and use the established
   preparation-required retry signal for a fresh attempt.
2. Risk: a cache miss silently falls back to KMS inside the transaction.
   Mitigation: require exact prewarmed state at the claim boundary and add a
   focused no-provider-in-transaction test.
3. Risk: permanent authenticated application corruption retries forever.
   Mitigation: separate successful crypto opening from JSON/schema parsing and
   retire only the exact locked row after authentication succeeds.

## Tasks

1. Add bounded pending-group payload-root preparation before the transaction.
2. Thread exact prepared state into the route claim and revalidate it after the
   winner is locked.
3. Split crypto opening from application parsing and narrow deletion to
   authenticated malformed plaintext.
4. Add focused unit/concurrency regressions and update the reliability claim.
5. Run focused tests, Web typecheck, diff/privacy hygiene, and parent review;
   leave exact-head ReviewGPT/CI/PR completion to the parent workflow.

## Decisions

- Preparation is speculative latency/capability work only; transaction-time
  candidate selection and authority checks remain canonical.
- A stale or missing preparation package is a retryable preparation mismatch,
  not evidence that the pending payload is invalid.
- Authentication and secure-box format failures are not application-schema
  failures and therefore never authorize deletion.

## Verification

- Focused Vitest coverage for pending-group claim and route preparation.
- Local PostgreSQL concurrency proof when the repository test lane is
  available.
- Hosted Web typecheck, `git diff --check`, direct-identifier guard, and final
  diff inspection.
- Parent-owned preliminary specialist ReviewGPT, final ReviewGPT, exact-head
  CI, mergeability proof, and plan closure.

## Verification log

- `pnpm --dir apps/web prisma:generate` completed; generated the local Prisma
  client needed by the focused hosted-web Vitest config.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-pending-group-setup-claim-crypto.test.ts apps/web/test/hosted-onboarding-linq-mailbox-root-prewarm.test.ts apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-prepared-thread-container.test.ts apps/web/test/hosted-onboarding-linq-read-receipt-authority.test.ts`
  passed: 5 files, 78 tests.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-thread-route.test.ts apps/web/test/hosted-pending-group-setup-postgres-concurrency.test.ts`
  passed the route-planning suite: 1 file, 144 tests. The real-PostgreSQL
  concurrency suite stayed skipped because its dedicated database environment
  gate was not enabled in this shell.
- `pnpm --dir apps/web typecheck` passed.
- `git diff --check` passed.
- Diff-only identifier/secret scan found no newly introduced home-directory,
  bearer-token, private-key, or database-URL patterns.
- Final focused rerun passed 2 files and 35 tests covering exact prepared-claim
  crypto handling and the pre-transaction Linq preparation owner.
- `bash scripts/check-agent-docs-drift.sh` passed after the live reliability,
  testing-map, and index claims were aligned with the final behavior.
Completed: 2026-08-10
