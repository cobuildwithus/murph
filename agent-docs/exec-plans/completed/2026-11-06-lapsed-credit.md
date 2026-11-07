# Spend remaining personal credit after billing lapses

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and protected invariant

Lapsed people can use their existing balance in private conversations. They receive
zero included allowance, regardless of stale billing metadata. Personal credit
never sponsors a room. Suspension, consent, strict lifecycle eligibility and
purchase eligibility retain their owners.

## Evidence and design

The allowance billing-reference resolver currently returns stale paid metadata
for unsponsored inactive people. Two admission guards hide that hazard. Resolve
funding once for reads, admission and settlement; strip lapsed direct metadata.
The lightweight access owner can read the existing balance projection, with
explicit sponsorship scope at callers that authorize another runtime.
No persisted state, enrollment, grant, billing or provider operation is added.
Existing beneficiary locks and immutable settlement remain authoritative.

## Product UX

Outcome: remaining credit continues to work after lapse and stops at exhaustion.
Entry: private conversation; positive credit permits AI, zero/negative credit
retains the existing billing notice. Family-funded people retain plan access.
Rooms cannot borrow lapsed personal credit. Active plans, incomplete/not-started
people, suspension and withdrawn consent keep their existing restrictions.
Proof: real PostgreSQL access, admission, settlement, concurrency and notice
predicates; full hosted-web suite and module-loading guards. No live delivery or
production changes are authorized. Product UX: Ready at the deterministic access,
accounting and notice boundaries; live delivery is outside this task.

## Tasks

1. Hydrate and reproduce the credit-only gap on isolated migrated PostgreSQL.
2. Correct funding and audit sponsor consumers; retain frozen settlement.
3. Run focused and full hosted-web proof, typecheck, lint, complexity and docs checks.
4. Update owners and changelog; inspect privacy/diff; close plan, leave uncommitted.

## Verification

- Hydration: install, incremental workspace build, Health Commons generation and
  Web Prisma generation all exited 0. The isolated local database was created
  and migrated with the repository migration owner (exit 0).
- Before implementation, the cleaned 16-case PostgreSQL regression failed in
  11 cases and passed 5 (exit 1). The failures expose denied positive credit,
  stale paid capacity, final-credit admission, and settlement attribution.
- Final focused selection: lapsed-credit-postgres, hosted-execution-usage-allowance,
  hosted-warm-control-imports and hosted-crypto-lazy-sdk: 173 passed, 4 files,
  exit 0. This includes all 18 new PostgreSQL cases.
- Web typecheck (prepared after hydration): exit 0. Web lint: exit 0 with existing
  warnings. Complexity: exit 0; the shared funding calculation removes duplicated
  admission branches. Documentation drift and gardening: exit 0.
- First completed full suite: 16,294 passed, 2 failed, 229 skipped across 1,014
  files (1,004 passed, 2 failed, 8 skipped), exit 1. The existing ledger-history
  scan test timed out at 60 seconds. A targeted run with origin/main Web source
  and tests restored temporarily passed (exit 0), so this is not classified as
  a proven baseline failure. The other failure was the new concurrency proof
  calling the generic recorder without runtime authority, exposing a lock-order
  deadlock. That proof now claims/prepares a real runtime and uses the actual
  managed callback, which locks the member before persistence; both admitted
  records settle, debit only the last credit and revoke further usage.
- The final caller audit also scoped all three pending-group batch candidate
  queries to strict sponsorship. Single and batch sponsorship assertions pass.
- Final full suite on a freshly migrated isolated local database: 16,294 passed,
  2 failed, 229 skipped (16,525 total); 1,004 files passed, 2 failed and 8 skipped
  (1,014 total). Actual exit code: 1; duration: 1,739.51 seconds.
  The known game deletion index-choice test failed. The mailbox usage-denial
  chronology test also failed when its 15-second transaction expired after
  roughly 17 seconds. That exact case passed on the candidate in isolation
  (1 passed, exit 0), then reproduced the same expired-transaction error and
  assertion failure with origin/main Web source/tests (1 failed, exit 1;
  roughly 24 seconds inside the transaction). The baseline comparison restored
  all candidate bytes afterward. This establishes a baseline timing failure;
  no unrelated production or test-timeout change was made. All 18 new lapsed
  credit cases passed in the final full run. The earlier ledger-history timeout
  and the known Telegram cleanup failure did not recur in this final run.
- Final typecheck, lint, complexity, docs drift and docs gardening: exit 0.
  Privacy scan and git diff --check passed. Hydration remained unchanged.
- Incomplete runs:
  Two earlier incomplete invocations exited 130 because the direct app config
  ignored the worker-count environment override. A third partial invocation
  exited 130 to incorporate the batch sponsorship audit. Only proven
  session-owned runners were interrupted; each database was recreated.
  Full commands use DATABASE_URL for the isolated migrated local database,
  MURPH_TEST_POSTGRES_CONCURRENCY=1 and the requested hosted-web command with
  explicit --maxWorkers=1. No test-name or file filter is applied.
- Tooling friction is recorded in
  `.agents/friction-log/20261106175343-direct-app-vitest/friction.md`.

## Money-path review

- Access and batch reads: only a real person's own positive balance widens AI
  access. Room owners and participants retain strict decisions. No heavy import
  or extra database round trip is added to the member-access owner.
- Read-only allowance and locked admission: the same funding resolver strips
  lapsed direct metadata and grants zero included capacity. No-balance lapse
  remains inactive before period writes; no Starter enrollment or grant occurs.
- Settlement: the same funding resolver charges the existing credit ledger;
  replay and managed runtime callback debits remain beneficiary-serialized. Real admitted
  overshoot is still recorded and absorbed under existing policy.
- Late settlement: lapsing mid-turn cannot erase counted spend, including when
  credit is already zero. Resubscription restores the existing paid allowance.
- Family: valid sponsorship takes precedence over lapsed credit; active paid
  direct-plan precedence remains unchanged.
- Rooms: Linq preparation, group planning and locked recovery, Telegram preparation
  and ingress, pending group setup, and canonical route provisioning explicitly
  request sponsorship-only access, including all pending-setup batch candidate reads. Pure room owner/participant decisions never
  receive a person's balance. Frozen game/room beneficiaries retain their path.
- Purchases and lifecycle: purchase eligibility, grants, welcomes, activation,
  and referrals keep their existing owners and strict reads.
- Notices: exhaustion of lapsed credit suppresses the Starter usage notice and
  returns the existing billing-inactive access notice. Suspension and revoked
  consent remain ahead of new spending.

## Deployment and proof limits

No schema or wire change. This is Web-owned admission and accounting; there is
no new Worker or runner capability. Rollback denies lapsed credit spending again
without removing ledger entries. No production action or live message was sent.
The model prompt, tool contracts and model-generated copy are unchanged, so
real-Codex reply-quality proof does not apply to this deterministic funding gate.
ReviewGPT, PR creation and source-PR provenance for the changelog belong to the
parent after its review and commit. All task files remain uncommitted by request.

## Operational boundaries

The hot access path adds one balance column to its existing member projection;
it adds no awaited call, provider request, retry, collection fanout or lock.
Single-person funding retains at most one existing Family lookup; batch access
retains its bounded member/participant queries. No model input changes for either
personal or group runtimes. Existing Web/runner usage contracts are unchanged;
new Web code owns the changed admission, so old Web retains the old denial during
rollout. Runtime callback revocation and frozen beneficiaries retain their
existing protocol. A rollback restores denial without erasing consumed credit.

Negative persisted balances are prohibited by a PostgreSQL constraint; the proof
asserts that rejection and checks the real read predicates with a negative
projection. Live provider delivery and production balances were not exercised.

## Handoff

Implementation, PostgreSQL proof, owner docs and changelog are complete. The full
suite was run without file/name filters; its two baseline failures remain
explicitly reported rather than called green. No live provider delivery,
production operation, commit, push or PR was performed. Parent review and commit
remain outstanding by request. The generic recorder without runtime authority
was not established as safe for overlapping independent calls; concurrency proof
covers the actual managed callback protocol and locked gate/settlement path.
The local test database and generated .swc cache are removed at handoff.
Completed: 2026-11-06
