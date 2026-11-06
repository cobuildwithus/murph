# Restore product worker access after billing lapse

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and protected boundaries

Signed-up people retain product and background-worker admission after billing lapses.
AI allowance, room sponsorship, frozen game beneficiaries, lifecycle welcomes and
referral qualification retain strict effective eligibility. No billing writes,
new Starter grants, schema, runner or iOS changes. Leave all work uncommitted for
parent review; no production access or deployment.

## Evidence and design

The current assertion alone permits lapsed humans. The pure, Prisma, batch and
scheduled SQL readers exclude them; owner and participant sponsorship reuse that
same predicate. Separate strict person eligibility from personal product access
at member-access.ts. Keep pure recovery and line-count projections in the
Prisma-only member-access-projections.ts leaf. Preserve
activation evidence through its existing mailbox-or-four-active-roots owner,
with matching set-based projections for returning incomplete accounts.

## Product UX

Outcome: connected Health imports and recovery can run while individual AI is off.
Journeys: each lapsed status, resubscription through incomplete, first signup,
Family sponsorship, all-lapsed and funded rooms, duplicate game rooms, withdrawn
consent, suspension, existing Linq home chat, new welcome destination, referrals.
Proof: real PostgreSQL predicates, worker claims and allowance gates; bounded
recovery; existing Linq, clinical, lifecycle and referral suites.
Done when product admission widens without new funding, onboarding or disclosure
and existing notices retain their cadence. Runner deterministic action routing
and credit-only AI remain separate steps.

## Tasks

1. Hydrate and capture failing regression proof; audit all access callers.
2. Correct central product projections and preserve strict monetary/lifecycle reads.
3. Split Linq notice choice; share recovery projections; move clinical transport.
4. Run isolated PostgreSQL suites, focused regressions, Web typecheck/lint,
   complexity and docs checks; inspect full diff and record remaining boundaries.

## Failure, rollout and authority

No schema or wire change. Web-only admission is compatible with the existing
runner; action/preferences behavior still needs separate step 2b. Old Web during
rollout can still refuse lapsed work; retry/recovery converges after deployment.
Consent/suspension and checkpoint locks remain mandatory. No deletion policy
changes. Audit the 15-minute billing retry separately from runner starts.

## Verification

The initial verification ledger records selected suites only, not a full Web
suite. The parent-review follow-up below supersedes that completion claim and
records the required full-suite result separately. Failed intermediate runs
remain diagnostic history.

## Caller audit

Paths below are relative to `apps/web/src/lib`, unless prefixed `app/`.
Search covered repository TS/TSX callers of `readActiveHostedMemberAccess*`,
`hasActiveHostedMemberAccess`, `activeHostedMemberAccess*Where`, their new
real-person projections, and strict Family reads. Unrelated `readActive*`
crypto, line-inventory and disclosure-grant helpers are not billing predicates.
Historical exported names remain unchanged.

| Caller(s) | Verdict and resulting boundary |
| --- | --- |
| `hosted-onboarding/member-access.ts`: pure, single, state, batch, Prisma predicates | Product for real humans. Four lapsed states pass; incomplete needs existing activation mailbox or all four active crypto roots. Suspension still fails. State and batch hydrate proof; SQL and Prisma agree in real PostgreSQL. |
| Same owner: container owner, participant and game allowance beneficiary paths | Funding. Strict own-active/Family sponsors only; leased participant cutoff unchanged. Ordinary beneficiary lookup explicitly requires a synthetic room. Exact-pair game fallback and frozen beneficiary remain unchanged. |
| `hosted-execution/usage-allowance.ts`: read and transactional container branches | Funding. Both use strict container/participant/game authority. Personal allowance still uses strict AI eligibility plus usage. No lapsed billing or product access creates a period, credit or grant. |
| `hosted-execution/runtime-owner.ts` | Product worker admission for people; strict room funding for synthetic identities. Consent/suspension floor is unchanged, including retention mode. |
| `hosted-mailbox/runtime-access.ts` | Product for real people and strict room access for synthetic identities. Separate AI decision remains authoritative for model work. |
| `hosted-orchestration/runtime-reconciliation-facts.ts` | Product classification, then consent, workspace/mailbox facts, then unchanged AI gate only when the wake needs AI. |
| `hosted-orchestration/preference-handoff-sweeper.ts` | Product SQL for people, strict SQL CTE for room owners/participants; consent and eligibility precede LIMIT. Live state rechecked before signal. |
| `device-sync/prisma-store/connections.ts`, `device-sync/scheduled-reconcile-preflight.ts` | Product; shared SQL selection before LIMIT and locked preflight retain consent/suspension checks. |
| `hosted-ops/runtime-maintenance.ts`, `hosted-ops/runtime-recheck-verification.ts` | Product recovery/maintenance; candidate count/page and batch verification widen together. Canonical resource cleanup is independently reference-protected. |
| `hosted-workspace/checkpoint-recovery.ts` | Product recovery; member/owner/workspace locks, consent, exact reference/version and staged-candidate proof remain mandatory. |
| `clinical-records/transport-access.ts`, `daily-sync.ts`, `retrieval.ts`; `app/api/legal/consent/accept/route.ts` | Product transport and resume, with suspension/consent and locked egress revalidation. Daily acquisition still requires launch consent. Enrichment and model usage remain separately AI-gated. |
| `connected-apps/service.ts`; `app/api/internal/connected-apps/route.ts` | Product connection management/sync. Existing consent and connection ownership still apply. |
| `app/api/internal/hosted-execution/email/resolve-route/route.ts` | Conversation admission, strict at both alias and direct call sites. Lapsed personal senders are refused; funded synthetic rooms retain their existing strict member eligibility. |
| `hosted-onboarding/webhook-provider-linq.ts`: prewarm, admission, roster | Product prep/admission/identity, separate strict AI notice decision. Existing active AI path short-circuits the extra product query. Home and new attested direct chats receive the existing notice without binding or queueing. Notice-free AI denial discards established product-member input; first-time signup is preserved. Roster eligibility is identity, not room funding. |
| `hosted-onboarding/webhook-service.ts` | Product crypto/mailbox preparation. No new activation or grant side effect. |
| `hosted-onboarding/webhook-provider-linq-reaction-context.ts`, `webhook-provider-linq-participant-context.ts`, `telegram-group-reactions.ts`; `hosted-routing/thread-route-store.ts` | Existing synthetic-room context/route authority remains strict sponsor/game eligibility through the canonical reader. Product widening is only the human branch. Route identity, roster and egress authorization remain mandatory. |
| `hosted-onboarding/linq-instant-first-turn.ts` | Product check under egress routing lock. Fresh opening continuation separately reads strict AI eligibility; lapsed direct admission no longer enters acquisition. Existing exact replay obligations are unchanged. |
| `hosted-onboarding/hosted-member-routing-linq.ts` | Product human line occupancy, plus separate live pending-signup reservation. Expired signup-only reservation remains excluded. |
| `hosted-onboarding/hosted-member-store.ts` | Signup-context NOT-product predicate remains to prevent acquisition of an existing lapsed member; atomic signup-email attempt uses strict eligibility. |
| `hosted-onboarding/channel-welcome.ts`, `signup-notification-email.ts` | Lifecycle, intentionally strict. Both preparation and locked welcome admission preserve old eligibility. No new welcome from widened product access. |
| `hosted-onboarding/member-activation.ts` | Lifecycle. Existing blocked-own-billing recovery exception uses strict Family sponsorship explicitly. Store-backed activation proof readers remain here with their original mailbox/roots definition; product reads use the matching pure database projection without loading those stores. |
| `hosted-growth/usage-referral.ts`: personal actor, group actor, introduced-member qualification | Lifecycle/reward qualification, intentionally strict. Already-qualified credit may settle after either party lapses; replay remains once-only. |
| `physical-notes/service.ts` | Product assertion remains; the complimentary/usage-bypass boolean uses `readStrictHostedMemberAccess`: strict people plus existing strict room/game sponsorship. Lapsed people retain step-1 usage checks before spend; funded rooms retain their complimentary behavior. |
| `hosted-onboarding/assistant-model-preference.ts` | Product settings; returning incomplete without sponsorship remains refused, as explicitly accepted by the parent. No extra proof relations on ordinary settings reads. Premium model tier eligibility remains strict; settings access does not authorize a model call. |
| `hosted-onboarding/authentication-completion.ts`, `companion-member-access.ts`, `page-auth.ts`, `invite-service.ts`; `app/join/page.tsx`, `app/groups/start/page.tsx` | Product/sign-in/onboarding-stage selection. Existing signed-up people bypass acquisition. Welcome owners independently enforce strict lifecycle eligibility. |
| `hosted-onboarding/member-channel-sync.ts`, `hosted-email-public-bootstrap.ts`; `better-auth/credential-change.ts` | Product channel ownership/crypto synchronization. Existing credential/channel proof remains; no new billing grant. |
| `better-auth/native-messaging-telegram-welcome.ts` | Strict person eligibility before the external welcome send. Active and Family-sponsored people retain delivery and channel sync; lapsed people stay awaiting inbound with no send or route write. |
| `hosted-groups/join-offer-reaction.ts`, `telegram-offer-callback.ts`, `group-tool.ts`, `group-join-outreach-drain.ts` | Product participation/acquisition suppression. Existing grant, participant and route checks remain; these reads are not room sponsors. |
| `hosted-groups/group-store.ts` (three grantor projections), `shared-freshness.ts`, `shared-companion-presence.ts` | Product shared-data availability. Explicit granted status, scope, destination/membership, current consent and suspension remain. Shared reads revalidate before decryption/publication. No new share is created. |
| `hosted-groups/group-email.ts` | Product for personal access; returning incomplete without sponsorship remains refused as accepted by the parent, with no extra proof relations. Participant sponsorship explicitly uses strict eligibility. Recipient consent/identity authority remains separate. |
| `hosted-vault-share/projection-store.ts` (both batch destinations) | Product delivery eligibility, existing granted shares and valid scopes only. Synthetic destination remains strictly funded. Grantor authority stays with shared projection owners. |
| `hosted-onboarding/billing-service.ts`, `starter-usage-enrollment-service.ts`, `stripe-event-reconciliation.ts` | Strict Family sponsorship for billing/qualification. No widening and no writes changed. |

## Failure-mode decisions and proof

- **Repeated inactive retry:** three successive 15-minute AI rechecks per lapsed
  state return `ai_usage_denied` with the next retry, and create zero runtime-owner
  rows. A separate explicit product claim succeeds. Rechecks may continue while
  AI work remains blocked; they are not runner starts. Live Temporal/container
  scheduling was not exercised, so actual deployment start counts remain a
  post-deploy check. Model-free device/system work follows the existing bypass.
- **Workspace retention:** the PostgreSQL claim/denial sequence retains its
  workspace. Maintenance only widens selection. Cleanup checks canonical snapshot
  and replica references plus pending puts under member/owner locks; billing is
  not a deletion criterion. No cleanup or retention policy changed. No claim is
  made about existence of production storage objects.
- **Consent and suspension:** real claims reject both after initially admitting
  each lapsed state. Device SQL and handoff limit-1 proof skip older ineligible
  rows. Clinical transport revalidates under the member lock before egress.
- **Shared data:** lapse alone stops hiding an existing grantor's authorized
  data. Grant status/scope, destination membership, consent and suspension remain
  required in capture/readback; new grants are not created. This is not a grant
  to an unfunded room, whose access remains strict.
- **Returning incomplete:** no proof denies; activation mailbox admits; after
  mailbox removal, only all four active roots admit; retiring a root denies.
  Single/state/batch/SQL agree. Billing subscription references are not proof.
- **Funding:** all four lapsed states deny personal read-only/read-first/mutating
  AI gates and all-lapsed room allowances. Active Family and leased participant
  sponsor matrices remain valid. Existing duplicate-room game proofs run with
  canceled humans/room seeds and charge the frozen primary once.
- **Linq/lifecycle:** each lapsed billing notice retains the existing bound-home
  response, without signup/activation/instant-start. Real strict welcome checks
  produce no mailbox/routing writes. Referral qualification remains strict;
  qualified rewards settle once after lapse. Physical-note usage remains required.
- **Clinical:** each lapsed daily-acquisition case creates its transport run and
  mailbox work, not AI usage. Retrieval uses the same access+consent predicate;
  external clinical providers were not contacted.

## Query shape and reply-path impact

The product predicate is a bounded per-member EXISTS projection, not a per-row
application loop. Single access remains one ordinary query; optional exact-game
fallback is unchanged. Returning-incomplete state reads add one plain proof query; batch adds at most
one set-based query for incomplete IDs. Group email/model preference snapshots
add no proof relation reads; their returning-incomplete refusal is retained by
explicit parent decision. No external work or new transaction is added.

On Linq direct admission, strict AI success reuses the existing decision and adds
zero product queries. An AI denial adds one product query (plus the pre-existing
optional game fallback), serially before classification. Denied home and new attested direct conversations perform the strict reread
before notice or discard. No network/provider calls, retry
policy or provider-visible prompt/schema content changed. Local SQL count and
composed Linq tests cover behavior; production latency was not measured.
Daily transport adds one locked product/consent read; no external provider call
moves inside a database transaction. Existing collection/page bounds are retained.

## Deployment and unfinished boundaries

**DEPLOYMENT CONCERNS:** Web-only change, with no schema, message, checkpoint or
runner protocol change. Deploy Web normally; existing runner and warm containers
remain compatible. During mixed Web versions, an old reader can still refuse
lapsed work; existing retry/recovery converges when all Web instances update.
Reverting Web restores the previous admission behavior without data conversion.
No production deployment or rollback was performed.

After deployment, verify the Web version, bounded handoff/device recovery and
clinical acquisition for synthetic lapsed accounts; count AI rechecks separately
from actual runner starts; inspect consent/suspension denials and workspace
references. This local work does not prove deployed mixed-version scheduling or
provider delivery. Deterministic action/preferences support belongs to step 2b;
credit-only AI funding belongs to step 2c. No runner/iOS change is included.

Billing remains outside product admission only for deliberately preserved
lifecycle welcome/activation/referral qualification, paid billing/enrollment
flows, and premium model tiers/spending subsidies. Individual AI itself remains
strict billing plus usage pending step 2c. Phone reservation, computer sign-in and
physical-note usage behavior from step 1 is preserved.

Product UX: Ready for parent review at the Web boundary, with the deployment
checks above outstanding. Changelog content only: `health-sync-after-plan-ends`,
2026-11-06; source PR number is intentionally empty until the parent opens a PR.
No prompt or provider input changed, and no model invocation is needed to prove
the access predicates; deterministic real-DB and Linq tests own this boundary.
The parent owns final ReviewGPT/CI on its eventual pushed head. User instruction
requires leaving this checkout uncommitted; no commit, push or PR was created.

## Verification ledger

All commands ran from the repository root. No production credentials or database
were used. PostgreSQL commands used the isolated loopback database
`postgresql://postgres:postgres@127.0.0.1:5432/murph_test_lapsed_worker`, with
`MURPH_TEST_POSTGRES_CONCURRENCY=1`. Unit sweeps set that flag to `0`.
Exit codes below come from the process/tool result, not a pipe's final command.

Command abbreviations (file arguments are always under `apps/web/test/`):

- **V** = `pnpm exec vitest run --config apps/web/vitest.config.ts`.
- **Access** = `hosted-member-access-postgres.test.ts`.
- **Game** = `game-chat-allowance-postgres.test.ts`.
- **Handoff** = `hosted-preference-handoff-sweeper-postgres.test.ts`.
- **Clinical** = `clinical-records-daily-sync-postgres.test.ts`.
- **Referral** = `hosted-usage-referral-recovery-postgres.test.ts`.
- **Device** = `device-sync-scheduled-wake-retention-postgres.test.ts`.
- **Status sweep** = files selected by `rg -l
  'canceled|paused|unpaid|past_due|HOSTED_ACCESS_REQUIRED' apps/web/test --glob
  '*.test.*'`. Unit final excludes names containing `postgres`, then adds
  `changelog-page.test.tsx` (108 files). PostgreSQL filename sweep uses
  `--glob '*postgres*'` (23 files, including Device and Referral).

| Command / run | Exit | Observed result |
| --- | --- | --- |
| `pnpm install --prefer-offline` | 0 | Dependencies hydrated. |
| `pnpm build:workspace:incremental` | 0 | Workspace build passed. |
| `pnpm --dir packages/health-commons generate` | 0 | Explicit final rerun passed. |
| `pnpm --dir apps/web prisma:generate` | 0 | Explicit final rerun passed. |
| `psql` create isolated database; `DATABASE_URL=... pnpm --dir apps/web prisma:migrate:deploy` | 0 each | Local schema ready. |
| V Access before implementation | 1 | Four lapsed product admissions failed; original strict matrix passed. Intentional red proof. |
| V Access Game Handoff after initial implementation | 0 | 21 passed. |
| `pnpm --dir apps/web typecheck`, first and second attempts | 2 each | New helper client/type annotation errors; fixed. |
| `pnpm --dir apps/web typecheck`, third attempt | 0 | Production/helper typing passed. |
| V `--maxWorkers=2` initial full status sweep with PostgreSQL disabled | 1 | 49 failed, 4411 passed, 597 skipped; nine unit files had old semantics/mocks. |
| V nine failing unit files after correction | 0 | 435 passed. |
| V Access Game Handoff Clinical | 1 | 37 passed; one synthetic crypto fixture violated its envelope-shape constraint. |
| V Access after fixture correction | 0 | 7 passed. |
| V Access Referral | 1 | 8 passed; new referral assertion omitted the tool result wrapper. |
| V Referral Device | 1 | 49 passed; four new assertions used SQL rather than mapped field names, and referral cleanup violated credit-grant FK order. Fixed fixtures/cleanup. |
| V Referral Device `-t 'strict referral|selects.*device work'` | 1 | Four device cases passed; prior failed cleanup left a conflicting synthetic phone row. |
| `psql` drop/recreate isolated database; `DATABASE_URL=... pnpm --dir apps/web prisma:migrate:deploy` | 0 each | Fresh local database removed that failed-fixture residue. |
| V `--maxWorkers=2` final unit status sweep plus changelog | 0 | 106 files passed, two skipped; 4433 tests passed, 47 DB-gated tests skipped. Those DB suites are run separately below. |
| `pnpm --dir apps/web typecheck`, final first attempt | 2 | Newly added referral test used a nullable lookup-key return as a string. Added a checked synthetic key. |
| `pnpm --dir apps/web typecheck`, final subsequent runs | 0 each | Latest production and test changes typecheck. |
| `pnpm --dir apps/web lint`, explicit final runs | 0 each | Passed, existing warnings only. |
| `pnpm complexity:diff`, final first attempt | 1 | Linq admission grew complexity debt by one. Removed a repeated condition using the existing mutually exclusive branches. |
| `pnpm complexity:diff`, corrected final attempt | 0 | 20 changed source files, 27 existing hotspots; no increased complexity debt. |
| `pnpm --dir apps/web changelog:generate` | 0 | New fragment accepted. |
| V `hosted-onboarding-linq-dispatch.test.ts changelog-page.test.tsx` | 0 | 231 passed after final Linq branch simplification. |
| V `--no-file-parallelism` PostgreSQL status filename sweep | 1 | 621 passed, eight failed across two files (629 total); obsolete paused-worker and acquisition-outreach expectations. |

The nine corrected initial unit files were device settings, email callback
routes, Linq dispatch, member store, reconciliation facts, signal runtime, signup
notification, referral tool, and lapsed product access. They are included in the
passing final status sweep.

The eight old PostgreSQL expectations were corrected by preserving negative
coverage with never-started members, explicitly admitting paused product work
while denying AI, and testing lapsed acquisition suppression. Existing opener
routing is still covered for signup-only people; SMS opt-out is exercised after
an opener is accepted and the person becomes lapsed.

Additional database suites are selected by their environment gates rather than
filename: dirty account deletion concurrency, paid-period migration, Linq
participant-addition concurrency and iMessage mini-app account deletion.
The latter also uses `MURPH_IMESSAGE_ENROLLMENT_TEST_DB_URL` set to the same
isolated database. Their final outcomes and database cleanup are recorded below.

Repository-wide status-name search also found unrelated experiment/automation
pause states and unchanged runner fixtures. All access-helper callers are in Web;
no runner or package source changed. The executed status sweep covers the Web
boundary, including the DB-only branches rather than claiming skipped tests pass.

| Final command / completion check | Exit | Observed result |
| --- | --- | --- |
| V `--no-file-parallelism` corrected runtime-owner and group-outreach suites plus the four DB-gated suites named above | 0 | Six files, 196 tests passed. All 27 selected DB suites now pass using the last result for each file: 684 tests. |
| `git diff --check` and added/untracked-content identifier scan | 0 | No whitespace errors or direct personal identifiers found. |

The PostgreSQL filename sweep's 21 passing files were not unnecessarily repeated;
the two corrected files and four previously disabled suites were run in full.
Local provider/network boundaries use existing synthetic adapters. No actual
clinical retrieval, message delivery, paid AI call, production record or runner
start was invoked. ReviewGPT and exact-head CI remain the parent's PR gates.

Final candidate review found that using a strict *person* reader for physical-note
subsidies would exclude existing participant/game-funded rooms. Corrected this
before handoff with `readStrictHostedMemberAccess`: strict people OR the existing
canonical room projection, followed by its exact-game fallback. It adds no query
on ordinary success and never admits an unfunded lapsed human. Real PostgreSQL
person/Family/owner/participant matrices now exercise this reader; game tests
also prove both funded rooms pass while their lapsed human players do not.
Physical-note service/replay tests retain their existing group success behavior.
The isolated database was recreated solely to run this final correction proof.

| Final correction and docs command | Exit | Observed result |
| --- | --- | --- |
| `psql` drop/recreate isolated database and `pnpm --dir apps/web prisma:migrate:deploy` | 0 each | Fresh database for the strict member subsidy proof. |
| V `--no-file-parallelism` Access Game `physical-notes-service.test.ts physical-notes-replay.test.ts` | 0 | Four files, 66 tests passed. |
| V Game after adding explicit strict-room/player assertions | 0 | One real PostgreSQL game test passed. |
| `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web lint`, `pnpm complexity:diff` after strict-member correction | 0 each | All passed. |
| `pnpm --silent docs:drift` | 0 | Passed. |
| `pnpm --silent docs:gardening` | 0 | Zero issues. |

The final correction changes only the spending-subsidy reader and its physical-note
call site. Its focused proof reruns both person/room predicates and service/replay
success paths; the earlier passing product and worker sweep remains applicable.

Final cleanup: `psql` dropped `murph_test_lapsed_worker` successfully (exit 0).
No test database, task process, commit or deployment remains. Final source/test
readback and identifier scan found no leakage; `git diff --check` passed (exit 0).
`pnpm --dir apps/web typecheck:prepared` and Web lint were rerun after the last
isolated game assertion edit and both passed (exit 0). The change contains 20
source files (274 added / 196 removed lines), 24 test files (373 / 63), the
architecture/index/execution record, and one changelog fragment. No generated
source, schema, configuration, dependency, runner or iOS file changed.
Completed: 2026-11-06


## Parent-review follow-up (2026-11-06)

This section corrects the initial selected-suite completion claim. The user
explicitly requested updating this completed plan and keeping all edits
uncommitted. Parent settings/channel-sync/member-store corrections and changelog
copy are preserved. The pre-existing `.swc/` directory is not task-owned.

### Findings and verdicts

- **Import graph: real regression, fixed.** Pure person and activation proof
  Prisma/SQL projections now live in `member-access-projections.ts`, importing
  only Prisma. Device SQL and Linq occupancy import that leaf. Store-backed
  readers are restored to `member-activation.ts`; incomplete product state uses
  a plain projection query. Warm-control, lazy-SDK and settings-route import
  tests pass unchanged.
- **Webhook idempotency: stale fixture sequencing.** Product classification adds
  a read after denied AI access, and direct notice admission rechecks strict
  eligibility. The fixture now supplies each state in order and proves the
  selected-member lock precedes exact access, the route lock precedes refreshed
  product and strict access, and both precede append. No lock was removed.
- **Preference handoff, maintenance (three cases), and due-device SQL: stale
  shapes.** Assertions now use the resolver projection or check the shared SQL
  eligibility before LIMIT. Real PostgreSQL tests cover lapsed admission,
  suspension/consent exclusion, strict sponsors and bounded recovery.
- **Home device-onboarding fixture: stale proof response found by the full run.**
  The incomplete fixture fell back to its default active row on the new proof
  query. It now explicitly returns no proof; the refusal assertion is unchanged.
  The origin/main assertion had no incomplete-proof query, confirming this is
  caused by the changed read shape, not an unrelated baseline failure.
- **Native authentication delivery fixtures: stale eligibility.** Four real-PG
  cases expected a welcome for newly issued not-started accounts. Their shared
  Telegram fixture now explicitly activates the member and supplies the async
  signal result. Authentication, replay, concurrency and identity-removal
  assertions remain intact. Four added cases prove lapsed members still link
  their identity successfully without a welcome or conversation item.
- **Action approvals database: local schema failure.** The unchanged suite
  passes against the isolated migrated database.
- **New direct Linq: real bug, fixed.** The same billing notice is returned for
  home and new attested direct chats for every lapsed status and resubscribing
  incomplete. No home binding, mailbox item, activation or instant-start is
  created. Existing notice delivery/cadence owner is reused.
- **Email resolver: real bug, fixed.** Both callers use strict member access.
  Personal lapse returns no route; funded room compatibility is preserved.
- **Native Telegram welcome: real bug, fixed.** Strict person eligibility is
  checked before sending. Real database cases cover all four lapsed states,
  active own billing and active Family sponsorship.
- **Additional Linq no-notice denial: real holding bug, fixed.** Established
  product members with a strict AI denial and no notice are ignored before
  binding/append, rather than reclassified as signup or held for later funding.
  The final fixture uses returning incomplete with no subscription reference and
  exercises the real product and strict decision functions.

### Conversation-lane audit and limits

Direct Telegram already checks the strict AI decision before appending input;
denial returns ignored. Its earlier route-identity synchronization is unchanged.
Linq explicit/group routes retain canonical strict room funding. Voice input
requires the admitted default runtime owner with `platformAiUsageAllowed` before
append. Game chat has exact-room/runtime authority and strict room sponsorship.
Computer-use completion, Linq delivery/engagement and reaction paths consume
existing run, sent-message, mailbox or funded-room authority; they do not create
new personal ingress from widened product eligibility. Public email bootstrap
creates an identity challenge, not conversation input; actual route resolution
now rejects lapsed personal conversation before storage/append.

The signed email-ingress callback trusts the earlier resolver result; it does not
recheck funding at append. An already-authorized email can cross a subsequent
billing lapse, as could other accepted work. Altering those replay/acceptance
contracts is not the same small ingress fix and was not attempted. This work
proves refusal of new lapsed input at admission, not deletion or reclassification
of messages admitted before lapse. No live provider/model/runner was invoked.

### Follow-up verification ledger

All database proof uses migrated loopback `murph_test_lapsed_fix`, with
`DATABASE_URL` and `MURPH_TEST_POSTGRES_CONCURRENCY=1`. File execution is serial
(`MURPH_VITEST_FILE_PARALLELISM=0`) to avoid the known shared runtime-cutover
singleton test race (existing Frog entry `20261101224941-shared-postgresql-proof`). The
full run also points the iMessage enrollment test URL at the same local database.
No import-boundary test or SDK/consent mock was loosened.

| Command / proof | Exit | Result |
| --- | --- | --- |
| Seven parent-reported regression files before fixes | 1 | 8 failed, 65 passed, 34 skipped; import and shape failures reproduced. |
| Create database; `pnpm --dir apps/web prisma:migrate:deploy` | 0 each | Local schema migrated. |
| Linq/email/native welcome regression selection before fixes | 1 | 19 failed, 7 passed, 252 skipped. Native fixture initially lacked the signal mock; corrected before meaningful native red proof. |
| Native welcome real-PG matrix before fix | 1 | Four lapsed cases failed; active and Family passed. |
| Three unchanged import-boundary suites after graph fix | 0 | 37 passed. |
| Fourteen focused suites after fixes | 1 | 400 passed, 2 failed plus one parse-failed suite. Remaining stale fixture sequencing/proof mocks and a SQL assertion quote were corrected. Action approvals ran and passed on migrated PostgreSQL. |
| Additional no-notice Linq regression before fix | 1 | Input was incorrectly queued; one failure reproduced. |
| Five corrected focused files after final Linq helper extraction | 0 | 289 passed, including no-notice denial and route-lock ordering. |
| `pnpm --dir apps/web typecheck` | 0 | Passed after removing obsolete proof-module test import. |
| `pnpm --dir apps/web lint` | 0 | Passed. |
| `pnpm complexity:diff` | 0 | Passed after extracting cohesive inactive-direct admission; 21 changed source files, 27 existing hotspots. |
| `device-sync-home-onboarding.test.ts` after fixture correction | 0 | All 14 tests passed; refusal without activation proof retained. |
| No-notice Linq case using real decision functions | 0 | Returning incomplete is ignored with no notice, binding or queued input. |
| Web typecheck and lint after Linq/home-onboarding test updates | 0 each | Passed. |
| Native auth PostgreSQL suite while full run was still active | 1 | 110 passed, one global member-count assertion failed during overlapping database work. All corrected Telegram and new lapsed cases passed. This run is not accepted as isolated suite proof; repeat serially. |

| First full `pnpm exec vitest run --config apps/web/vitest.config.ts --project hosted-web` | 1 | 1,003 files passed, 3 failed, 7 skipped; 16,275 tests passed, 6 failed, 222 skipped (16,503 total). Duration 1,540.14 seconds. Five fixture failures corrected; one baseline index-plan failure investigated below. |
| Serial recheck: native auth, game account deletion, device home onboarding, Linq dispatch | 0 | Four files, 383 tests passed. The earlier overlapping count failure does not recur serially. |
| Real no-notice regression with only its discard guard temporarily removed | 1 | Returning incomplete input was queued incorrectly. Original source restored byte-for-byte; the guarded test had already passed. |
| Fresh database drop/create and migration for baseline probe | 0 each | Isolated local schema reset. |
| `origin/main` raw query-plan assertion on empty analyzed tables | 1 | Reproduces `game_event_pkey` / `game_pkey` instead of the asserted actor/type index. Uses two distinct synthetic actors and the exact baseline SQL; no application access helper involved. |
| Fresh database drop/create and migration for final full run | 0 each | Clean isolated schema; no concurrent database test runs. |

The baseline query and assertion were extracted from `origin/main` at
`04c5fa82e694a62c37b05ef4aa75de0eb2ab546a`; the game schema/index, test and Prisma
client code on this path are unchanged. A direct later probe and the serial game
suite pass once database statistics differ. This is an existing statistics-
dependent test assertion, not a change to the game query. No assertion, index,
planner setting or test selection was changed to conceal it. Frog entry
`20261106165915-game-account-deletion` records the reproducible empty-table case.
The entry remains uncommitted under the user's explicit no-commit instruction.

### Clean origin/main verification of remaining full-suite failures

A separate detached checkout at `acf0dc8960dace15d3572858968746e15014ecd0`
contained none of the task changes. It was created with `scripts/create-worktree`
and hydrated through the normal public commands. Its database was the separately
migrated loopback `murph_test_lapsed_baseline`; it never shared the final task
run's database. The relevant tests and owners are unchanged from the earlier
baseline commit used for the raw SQL probe.

| Baseline command / proof | Exit | Result |
| --- | --- | --- |
| Create detached worktree | 0 | Clean origin/main checkout. |
| `pnpm install --prefer-offline`, `pnpm build:workspace:incremental`, Health Commons generation, Web Prisma generation | 0 each | Baseline hydrated without task code. |
| Create baseline database and deploy migrations | 0 each | Fresh baseline schema. |
| V native member PostgreSQL suite, `-t 'native Telegram rejects expired pending start'` | 0 | Original expired-proof test passes but leaves pre-auth state. |
| V auth adapter PostgreSQL suite, `-t 'reclaims expired sessions and pre-auth state'` | 1 | Exactly the full-suite cleanup failure: three deletions, expected two. |
| `ANALYZE game_event; ANALYZE game;` then V game account deletion, `-t 'uses the actor and type index'` | 0 / 1 | Original index assertion fails, selecting the primary-key indexes. |
| Drop baseline database | 0 | Baseline database removed. |
| `scripts/retire-worktree --contained-detached` | 0 | Temporary clean baseline checkout retired; no branch changed. |

The second remaining failure is sequential test residue, not concurrent task
execution: a native Telegram expired-start fixture leaves a global verification
row, and the auth cleanup fixture assumes it owns every expired row. It is
recorded in Frog entry `20261106172042-expired-native-telegram`. Both baseline
tests remain unchanged in this task. No database, retention or index production
behavior was altered to make these checks pass.

### Final follow-up result

The requested fixes are complete and uncommitted. The full Web suite is **not
green**: its only remaining failures reproduce without this task's changes on
clean origin/main. They are recorded in the two Frog entries above, and neither
assertion was loosened or excluded. The three import-boundary tests remain
unchanged. Parent settings simplifications, member-store/channel-sync fixes and
changelog copy are retained.

| Final command / proof | Exit | Observed result |
| --- | --- | --- |
| `pnpm exec vitest run --config apps/web/vitest.config.ts --project hosted-web` | 1 | 1,004 files passed, 2 failed, 7 skipped (1,013 total); 16,283 tests passed, 2 failed, 222 skipped (16,507 total). Duration 1,906.76 seconds. |
| Web typecheck and lint after all test fixture changes | 0 each | Passed; lint retains existing warnings. |
| `pnpm complexity:diff` on the final source shape | 0 | No increased complexity debt. The temporary red-proof guard removal was restored byte-for-byte before the final full run. |
| Drop `murph_test_lapsed_fix` | 0 | Main test database removed after the full process exited. |
| `pnpm --silent docs:drift` | 0 | Final documentation drift check passed. |
| `pnpm --silent docs:gardening` | 0 | Zero issues. |
| `git diff --check` and identifier scan | 0 each | No whitespace errors or direct personal identifiers in authored additions. |

The full run used the exact requested command, `DATABASE_URL` pointing at the
freshly migrated isolated database, `MURPH_TEST_POSTGRES_CONCURRENCY=1`, serial
file execution, and the local iMessage enrollment test URL. No other database
test process shared that final run's database. Action approvals and the named
parent-review regressions ran for real and passed. The two failing tests are:

- `better-auth-adapter-postgres-concurrency.test.ts`: expired global pre-auth
  residue makes cleanup delete three rows instead of the fixture's two.
- `game-account-deletion-postgres.test.ts`: empty-table statistics allow the
  planner to choose primary-key indexes rather than the asserted actor/type one.

The 222 skipped tests are not claimed as verified. No live provider delivery,
paid model execution, deployment, production data or post-deploy runner count
was exercised. Previously admitted email crossing a later billing lapse remains
the existing replay boundary described above. Web-only rollout/skew and the
separate action/preferences and credit-only AI steps remain as documented.
Both isolated databases are dropped and the baseline checkout is retired.
The original dirty worktree, parent edits and pre-existing cache are preserved.
No commit, push, PR or deployment was made.

## Parent review and deep review outcomes

- Parent review removed activation proof from assistant settings and group email, because those relation reads ran on every settings read for a brief state. A returning `incomplete` member being refused there matches prior behavior and is accepted. Reintroducing each trap fails real PostgreSQL tests: funding lapsed rooms fails 2, widening referral fails 1, and leaving the worker off fails 13.
- The full Web suite found an import regression hidden by the first selection of tests. The pure projections moved to a Prisma-only module so warm control and lazy SDK paths stay lean.
- Deep review round 1 found silent holds on new Linq chats and on email, and a Telegram welcome reachable by lapsed members. All three fixed. Round 2 found a billing notice reachable by a first-time `incomplete` member on a new chat, and an extra query for Family-sponsored `incomplete` members on mailbox fetch. Both fixed test-first.
