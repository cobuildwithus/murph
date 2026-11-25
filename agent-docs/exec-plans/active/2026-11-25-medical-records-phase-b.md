# Phase B hospital records

Status: active (daily notification readers in draft)
Created: 2026-11-25
Updated: 2026-11-25

## Goal and success criteria

Prove one asymmetric Epic patient app in the sandbox, ship the companion settings early, and deliver at most one authorized notice for actual changes in a daily import. Each PR owns its evidence and deployment gate.

## Scope and tasks

1. **PR A (this change), registration and sandbox proof.** Web resolves the exact client ID for each environment at start, callback and refresh. Keep public, organization-approved and Basic readers while sessions or grants need them. Publish separate public key sets, exercise S256, code exchange and two rolling renewals with same-patient reads. Production activation is a separate owner decision.
2. **PR B, daily access and settings.** Preserve an existing offline grant against an insufficient replacement under the member lock. Fence malformed or revoked grants and monitor due lag. Ship the Web-owned, revisioned message preference and companion v2 projection. Default to notice, require separate affirmative detail consent, cancel pending delivery on off, reset to off on consent withdrawal. If the owner chooses processor approvals (B7), use versioned per-entity entries in the existing consent ledger and gate start, persistence, daily admission and actual processor egress, including fallbacks. Resolve the processor inventory before attestation.
3. **PR C, first iOS release.** Show actual grant, message switch and detail consent, plus processor approvals if adopted. Remove misleading additions counts from the display while keeping legacy fields. Ship independently of source deletion.
4. **PR D, durable private receipts (parallel to A).** Core commits a replayable result with the canonical write, including both empty paths. Read it before filtering on retry. Record meaningful changes with stable enrichment identity and preserve receipts across restore. Missing legacy evidence stays silent. Receipts accumulate in one file per run without pruning. Each all-skipped batch costs a canonical write and one row. Define a retention rule before daily checks run at volume.
5. **PR E, notification admission and delivery.** Only trust receipts for runs admitted after receipt writers are deployed everywhere. Replaying a batch committed by an older runtime can write an empty receipt that looks identical to a proven no-change result. After readers converge, publish one fenced mailbox pointer per eligible daily run. Bind to the captured credential epoch and preference revision. Plain notices use the ordinary outbox directly. Detail uses a scheduled turn with the private receipt pointer. Recheck current authority, pacing, quiet hours and direct iMessage transport at dispatch. Fixed notices require product access. Prove retry, revocation, empty imports and out-of-order enrichment.
6. **Later, B6 source erasure.** Ship a dormant bounded eraser, then pending-state readers, retryable maintenance and iOS deletion. Fence OAuth and writers, preserve independently supported data, prove a sanitized cold checkpoint and restore floor. Keep readers and restore enforcement after first admission. Whole-account deletion supports the separate all-data questionnaire.
7. **Later, retire Basic.** Stop new Basic starts, drain sessions, inventory grants and leases, reconsent as needed, then remove credentials and readers.
8. **Later, retire the browser connection UI** under Phase A PR 3 after companion adoption.

## Decisions and constraints

Both start surfaces ask for offline access whenever their profile and discovery allow it. The portal controls duration. Use the existing OAuth session and encrypted refresh payload for client identity. A grant without a successor retains current production behavior. Keep production keys and all private records outside the repository. B7 is optional and B6 gates only per-source deletion.

## Risks and verification

A registration switch must preserve outstanding callbacks, leases and grants. Deploy readers and overlapping public keys before selecting a signer or changing start IDs. Roll back starts independently of ongoing obligations. A stable staging JWKS, draft app configuration, trusted local TLS and patient interaction are required for live sandbox acceptance. Confirm Epic distribution separately before rollout.

PR A runs focused SMART, control-plane and daily-sync/renewal tests, Web typecheck, lint and changed-code complexity. Later PRs own database races, receipt replay, consent, delivery and erasure proofs as their behavior ships.

### PR A evidence

The three focused suites passed 87 tests. Web typecheck and lint exited 0. Complexity reported zero hotspots above 20. A synthetic provider and browser exercised the proof entry point through its HTTPS loopback listener, both rolling refreshes and both patient reads. Omitting a successor failed at refresh, and changing the patient failed at read. Live sandbox discovery advertised the required capabilities. The interactive Epic grant, hosted key visibility, rotation and revocation remain deployment acceptance checks. The plan stays active across the remaining Phase B PRs.

### PR E1 · Dormant daily notification consumers

Deploy the nullable run columns first. Deploy the Web readers, Worker port and
hosted workspace readers before any admission writer. All creation paths in E1
leave the fences NULL. Old Web and old runners keep the original descriptor,
outcome and mailbox shapes. E1 can consume a synthetic eligible run through
private outbox or one-shot scheduling. The production plain-text provider
cannot promise iMessage-only delivery. The host blocks provider dispatch and
skips detail generation before exposing tools. Ordinary outbox preflight and
scheduled preflight both present the run key to the signed Linq engagement
owner with home-route fallback disabled. Local and hosted provider entry
reject a clinical text even if an older host returns an ordinary allowed route.

Local synthetic journeys queued one notice intent, one detail job, and no work
for off. No model or provider was entered. PostgreSQL exercised a real accepted
terminal, first late enrichment under a newer generation, lost handoff, durable
coverage, and revision, route and credential changes. A private workspace replay
rendered the generic notice and checkpointed the pointer. Real handset delivery
and revocation during an actual model turn require the strict sender in E2.

### PR E2 · Admission and activation boundary

1. Extend the existing protected post-deployment contract-migration lane with
   a machine gate. Require the compatible Web production SHA, all serving
   Worker versions and their port, and the exact receipt-capable runner image
   digest. Use the runner release provider's completed native rollout and
   drained-instance checks for every serving target. Refuse a pending rollout,
   mixed traffic, missing evidence or a pre-floor rollback target. Only then
   may the migration owner commit a pinned migration ID and checksum to
   `_hosted_web_contract_migration`. A Web build, an environment flag or a
   single successful callback supplies no fleet proof.
2. Have Web read that exact committed marker under the daily admission lock.
   Absence, mismatch or an unavailable marker keeps admission silent. Pin a
   receipt-required retrieval protocol for eligible runs so an older Web or
   runner cannot acquire their pages on rollback. Under the same lock prove
   the replacement-client ongoing grant, an accepted baseline for the current
   credential epoch, the live message revision and exact verified home route.
   Persist the epoch, revision and route fingerprint only on that new run.
   Establish baseline authority explicitly under each new authorization.
   Never backfill old rows from connection dates or generation numbers.
3. Before enabling successful text delivery, obtain and test an enforceable
   strict-text transport. Retain the provider refusal and the pre-model skip
   until the signed preflight and each outbound tool, retry and bubble are
   bound to the run and its single recipient. Recheck AI allowance for detail
   through ordinary scheduled execution. Prove an attempted alternate send,
   withdrawal during generation and downgrade between accepted bubbles using
   the strict sender. A service preference or capability lookup cannot clear
   this gate. Complete the positive detail journey with synthetic vault data.
4. Stop new admissions first on rollback. After the first eligible run, retain
   compatible receipt writers, schema, Web/Worker/snapshot readers, settings
   fences, recovery and egress guards until all outstanding work and restorable
   checkpoints are covered. Prevent selecting an older serving writer while
   the admission marker can authorize a new generation. Retain durable run
   coverage across mailbox, outbox and cron cleanup. E1 alone writes no
   eligible production runs and does not change the existing receipts floor.
