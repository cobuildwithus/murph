# Require classified device payloads and remove rollout repair

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Remove completed dirty-payload null-classification rollout support while retaining current reconnect, consent, credential-independent work, and acknowledgement behavior.

## Success criteria

- Every admitted payload keeps the existing server-derived boolean classification.
- Reconnect uses its existing member and dirty-marker locks, with set-based cleanup and no payload decryption or migration retry.
- A postdeploy contract migration rejects null classifications without modifying payload contents or guessing authority.
- Focused tests, relevant typechecks, and complexity review pass; a scoped commit and draft PR are ready for parent review.

## Scope

Remove the nullable classifier and its error/retry plumbing, require the existing Prisma field, add contract SQL and focused synthetic proof, and update the durable control-plane/testing owners. Preserve the historical expansion migration, classifier on new writes, ordinary OAuth recovery, and all unrelated device behavior. No production mutation or deployment is included.

## Constraints

The existing Web rollback floor already descends the boolean writer. The contract lane must repeat exact production and prior-function-drain proof before enforcing the constraint. A restored database must pass current migrations before the cleanup reader serves traffic; a null backlog stops contraction rather than being assigned an invented classification. No public artifact contains private operational observations.

## Product UX

Internal cleanup: no new member action, permission, message, or provider request. Synthetic reconnect tests prove accepted deletion work survives credential replacement, credential-scoped fetch work is discarded, and consent withdrawal and acknowledgement retain their ordering.

## Risks and mitigations

- Unsupported older writers or restored nullable rows: retain the deployment floor, enforce NOT NULL only in the postdeploy contract lane, and test fail-closed SQL.
- Removing migration code could weaken reconnect ordering: retain the existing member and dirty-marker locks and exercise both concurrent schedules against PostgreSQL.
- OAuth recovery must remain intact: remove only the error branch whose producer is deleted and run existing ingress/connection tests.

## Tasks

1. Remove completed classification migration flow and add the nonnullable contract.
2. Adapt concurrency tests to classified payloads and execute exact SQL behavior on a synthetic temporary table.
3. Run focused tests, typechecks, complexity and candidate diff/privacy review.
4. Close this plan, commit, push and open a draft PR; hand final review/CI ownership to the parent.

## Decisions

- Keep classification at the current write owner; no new table, job, default, backfill, or rollout horizon.
- Keep contract SQL separate from the immutable expansion history and predeploy migration path.
- Changelog not applicable: completed rollout support removal changes no supported member-facing promise.

## Verification

- `pnpm exec vitest run --config packages/device-syncd/vitest.config.ts --no-coverage --maxWorkers=1 public-ingress.test.ts`: passed, 83 tests covering ordinary OAuth success, consumed-claim recovery, ambiguous revocation, and exact cleanup ownership.
- Focused `apps/web/vitest.workspace.ts` run with an isolated loopback database and `MURPH_TEST_POSTGRES_CONCURRENCY=1`: passed, 122 tests across nine files. Coverage includes the current classify/preseal writer, OAuth replacement, both consent/acknowledgement lock schedules, independent-payload retention, scheduled-wake retention, immutable expansion history, and five exact contract-SQL cases.
- Applied the existing Prisma migrations and the exact new contract SQL to the isolated local database before the real store/concurrency proof. The temporary-table tests separately prove null inserts/updates are rejected and a retained null makes contraction fail atomically.
- `pnpm --dir apps/web typecheck` and `pnpm --dir packages/device-syncd typecheck`: passed.
- `pnpm complexity:diff --base 62609d5a09bf169eacd6e8be108e26fd41275035`: passed. Connection-store debt decreased by one. Reviewed all seven existing hotspots: token persistence retains refresh ownership and credential-kind rules; connection replacement retains member/provider/OAuth fences; dirty admission and hydration retain preparation, coalescing, and bounded-response rules; ingress start/callback/webhook retain provider lifecycle and replay/cleanup ownership. No further behavior-preserving deletion is established within this scope.
- `git diff --check`: passed. Candidate review found only scoped cleanup, synthetic proof, schema contract, and owner/plan changes; no private operational data or new dependency.

## Handoff

The implementation and focused proof are complete. The draft PR retains the existing `20260905000000_drop_clinical_record_duplicates` Web rollback floor, which follows boolean-writer commit `40245860a9`. The protected postdeploy contract lane owns exact deployment/drain proof and the final `NOT NULL` enforcement. No production mutation or deployment was performed. Parent session owns candidate review, Ready, final ReviewGPT and CI completion.
Completed: 2026-09-10
