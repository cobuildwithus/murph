# Phase B hospital records

Status: active (locked admission merged, private delivery in review, production dispatch closed)
Created: 2026-11-25
Updated: 2026-11-25

## Goal and success criteria

Prove one asymmetric Epic patient app in the sandbox, ship the companion settings early, and run at most one authorized records review for changes found by a daily import. Each PR owns its evidence and deployment gate.

## Scope and tasks

1. **PR A (this change), registration and sandbox proof.** Web resolves the exact client ID for each environment at start, callback and refresh. Keep public, organization-approved and Basic readers while sessions or grants need them. Publish separate public key sets, exercise S256, code exchange and two rolling renewals with same-patient reads. Production activation is a separate owner decision.
2. **PR B, daily access and settings.** Preserve an existing offline grant against an insufficient replacement under the member lock. Fence malformed or revoked grants and monitor due lag. Ship the Web-owned, revisioned message preference and companion v2 projection. Default to a private records review, cancel pending delivery on off, reset to off on consent withdrawal. The owner chose processor approvals (B7). Use versioned per-entity entries in the existing consent ledger and gate replacement start, persistence, daily admission and hospital transport. Check fixed runner destinations and hosted model selection against the recipient table. Resolve the processor inventory before attestation.
3. **PR C, first iOS release.** Show actual grant, message switch, plus one approval per named processor. Remove misleading additions counts from the display while keeping legacy fields. Ship independently of source deletion.
4. **PR D, durable private receipts (parallel to A).** Core commits a replayable result with the canonical write, including both empty paths. Read it before filtering on retry. Record meaningful changes with stable enrichment identity and preserve receipts across restore. Missing legacy evidence stays silent. Receipts accumulate in one file per run without pruning. Each all-skipped batch costs a canonical write and one row. Define a retention rule before daily checks run at volume.
5. **PR E, notification admission and delivery.** Only trust receipts for runs pinned at admission to a receipt-required retrieval and enrichment protocol. Replaying a batch committed by an older runtime can write an empty receipt that looks identical to a proven no-change result. After readers converge, publish one fenced mailbox pointer per eligible daily run. Bind to the captured credential epoch and preference revision. The private review uses a scheduled turn with the private receipt pointer. Recheck current authority, pacing, quiet hours and the frozen verified private route at dispatch. Reviews require product access and AI allowance. Prove retry, revocation, empty imports and out-of-order enrichment.
6. **Later, B6 source erasure.** Ship a dormant bounded eraser, then pending-state readers, retryable maintenance and iOS deletion. Fence OAuth and writers, preserve independently supported data, prove a sanitized cold checkpoint and restore floor. Keep readers and restore enforcement after first admission. Whole-account deletion supports the separate all-data questionnaire.
7. **Later, retire Basic.** Stop new Basic starts, drain sessions, inventory grants and leases, reconsent as needed, then remove credentials and readers.
8. **Later, retire the browser connection UI** under Phase A PR 3 after companion adoption.

## Decisions and constraints

Both start surfaces ask for offline access whenever their profile and discovery allow it. The portal controls duration. Use the existing OAuth session and encrypted refresh payload for client identity. A grant without a successor retains current production behavior. Keep production keys and all private records outside the repository. B7 gates the replacement registration. B6 gates only per-source deletion.

## Risks and verification

A registration switch must preserve outstanding callbacks, leases and grants. Deploy readers and overlapping public keys before selecting a signer or changing start IDs. Roll back starts independently of ongoing obligations. A stable staging JWKS, draft app configuration, trusted local TLS and patient interaction are required for live sandbox acceptance. Confirm Epic distribution separately before rollout.

PR A runs focused SMART, control-plane and daily-sync/renewal tests, Web typecheck, lint and changed-code complexity. Later PRs own database races, receipt replay, consent, delivery and erasure proofs as their behavior ships.

### PR A evidence

The three focused suites passed 87 tests. Web typecheck and lint exited 0. Complexity reported zero hotspots above 20. A synthetic provider and browser exercised the proof entry point through its HTTPS loopback listener, both rolling refreshes and both patient reads. Omitting a successor failed at refresh, and changing the patient failed at read. Live sandbox discovery advertised the required capabilities. The interactive Epic grant, hosted key visibility, rotation and revocation remain deployment acceptance checks. The plan stays active across the remaining Phase B PRs.

### B7 named approvals

The app reads and changes one current company decision through the companion
processor-approvals endpoint. The consent event and grant share the existing
member lock. The replacement registration has a separate admission gate at
start, callback persistence, daily check and records transport.

Current approvals admit a replacement import. Missing, stale or withdrawn
approvals block the next hospital read. B7 initially classified five companies as named.
B8 below records the owner's final classification.
Audio attachment transcription is separate from hospital document processing.
The runner tests the fixed destinations and hosted inference selection against
the same table that supplies the app notices. Imported copies remain available
in the vault after withdrawal.

Before the owner attests in Epic:

1. Confirm from registration and deployment history that no replacement-profile connection was saved before the profile marker deployed. The client ID is inside the encrypted grant, so existing unmarked rows cannot be backfilled from control metadata.
2. Reconcile the published subprocessor list with the processor inventory.
3. Verify the released approval screen and the member-requested uses in B8 against deployed routes.

The synthetic PostgreSQL test admitted a daily run with every named grant current,
fetched a hospital page, withdrew one grant and observed no further hospital
request. Separate callback tests cover a withdrawal while SMART is open. Adding
a synthetic unknown runner host failed the classification test as intended.

### PR B8 · Optional helpers

Under the replacement registration, each member approves OpenAI by name before connecting a hospital. OpenAI reads records to organize them and answer questions. xAI searches X, Google answers questions about a shared video, ElevenLabs makes a voice message and Mapbox finds places and directions. Murph uses them as part of its ordinary features, usually because the member asked. The approval screen names all four in one sentence supplied by the registry.

B7 and E1 continue to check every named company. The four member-directed services need no grant. The companion GET adds their names and purposes in `alsoUsed`. Retired scopes stay in the ledger and have no effect. The owner chose this classification, as with delivery, and accepts that nothing in code limits these four to turns the member started: a Murph-seeded scheduled turn may use them. It needs no switches, per-member restrictions or egress changes. The owner declined a turn-origin restriction on 2026-11-25. A grant stored under a retired scope cannot be withdrawn through the route; the scope is inert.

### PR E1 · Dormant daily notification consumers

Deploy the nullable run columns first. Deploy the Web readers, Worker port and
hosted workspace readers before any admission writer. All creation paths in E1
leave the fences NULL. Old Web and old runners keep the original descriptor,
outcome and mailbox shapes. Private review jobs use the original run key and verified direct thread.
The runtime requires positive signed Web authorization at generation, staging
and provider entry. Off leaves the conversation silent.

Replacement-profile notifications use B7’s current named approvals at proof, scheduling and egress. A terminal run that lost approval keeps its import outcome and suppresses the occurrence, including proofs received after reapproval. The companion app continues to show the approval requirement alongside the saved message setting.

### PR E2 · Admission and activation boundary

**Reader rollout (#5318).** Web, the hosted runtime and the manually deployed port
read the pinned receipt protocol on every page, enrichment and restore. Signed
provider receipts may echo a reply through Web memory. Web verifies the receipt
and removes message parts and clinical provider prose before persistence,
logging or orchestration. The terminal retry owner excludes clinical keys
before requesting provider text.

**Locked admission (#5323).** Under the daily member lock the writer freezes the
replacement ongoing grant's credential epoch, accepted baseline, current
OpenAI approval, preference revision and verified private route. Eligibility is
never backfilled. First imports, member starts and legacy runs stay silent
through late enrichment. A change receipt can precede the accepted terminal
outcome or arrive after a later daily check has started. It belongs to its
originating run. A later eligible daily admission supersedes an older unannounced receipt. Empty receipts produce no notification.

**Private reply path (#5325).** Reviews use the frozen private
thread on the service Linq selects. A detail turn has the same shell and
network reach as any scheduled turn, bounded by the Worker’s existing
messaging-operation check. The clinical per-bubble checks cover the reply
path only.

**Activation change.** The system mailbox queues one scheduled assistant
review of the originating run’s receipt. The private turn uses the ordinary
scheduled allowance, helpers and frozen audience. Web checks the
accepted run, receipt, frozen route, credential epoch, approval, consent and
setting at generation, staging and each provider entry. Line health and proactive
pause still apply. Terminal retry excludes every clinical bubble before fetching
provider message parts.

A fresh generation may run only while no reply has been durably saved and no
provider attempt was possible. The first encrypted reply checkpoint owns the
run, and Web binds its opaque reference and turn ID so every retry drains only
that reply and discards other generations. A restore older than a bound
checkpoint which cannot supply its reply ends the occurrence silently and
consumes coverage.

A detail reply uses the ordinary native voice memo. If the runner loses the
result after Web grants dispatch, the handoff consumes coverage and that bubble
is abandoned while other saved bubbles can continue under their own keys.

The published change waits for restored allowance as model-owned mailbox work.
A temporary model failure leaves the same one-shot pending with cron backoff.
Both holds stay silent. Every retry rechecks the run and its expiry.
The private one-shot is removed after completion. The originating run retains
the binding across local cleanup. Web records provider outcomes and holds
transient blocks on that run. A regional window supplies its next safe wake.
A missing verified number or unsupported region has no timer. Verification can
wake the hold, and every wake rechecks current authority. A transient handoff
gets one timed recovery wake. Only the newest eligible run can deliver for a connection,
and its occurrence expires 24 hours after acceptance. A permanent block closes it silently.
A lost dispatch response for the first text bubble ends the reply when Web has no recorded provider attempt.

**Deploy and operate.** Apply the expand migration first. It changes the
database default to detail, converts stored notice rows and advances their
revision, and normalizes writes from draining Web instances. Off stays off.
Deploy detail-by-default Web, promote the revision 4 hosted runtime, then
manually deploy the revision 4 Cloudflare port from main. The Epic client
switch is pending, so there are no eligible production runs in flight.
Build 126 may submit either on value. Revision 3 understands the existing
detail reply binding, but the new Web admission gate waits for fresh
nonce-bound evidence of both revision 4 readers and the promoted fingerprints.
Ordinary retrieval continues during skew. Verify both readers before activation.

The owner must publish the production public JWK, register the production
callback and JWK Set URL with the replacement Epic patient app, enable ongoing
access, and select its client ID and matching hosted signer as documented in
the intake spec. The checked-in production key set is empty until registration. A member needs an ongoing grant, current OpenAI approval, a
verified private route and an accepted baseline in that credential epoch. Roll
back admissions first by setting `CLINICAL_DAILY_NOTICE_ADMISSION_PAUSED=1` on
Web. Retain detail-by-default Web as the settings rollback floor. After
admissions open, retain revision 4 or later at the runner and port through
outstanding work and restorable snapshots. Preserve the dispatch fence,
saved reply binding and terminal retry exclusion.

**Database contract in a later PR.** After pre-cutover Web writers and rollback
targets drain, use the gated post-promotion contract migration. In one transaction,
verify zero `notice` rows, drop the normalization trigger and function, rename
"ClinicalRecordMessageMode" to "ClinicalRecordMessageMode_old", create the
replacement "ClinicalRecordMessageMode" enum with labels 'off' and 'detail',
drop the hosted_member.clinical_record_message_mode default, cast the column
through text to the new enum, restore its 'detail' default, and drop the old type.
Keep the build 126 request alias. Historical detail acceptance events remain
audit history. Eligibility reads the member setting and named processor approval.
