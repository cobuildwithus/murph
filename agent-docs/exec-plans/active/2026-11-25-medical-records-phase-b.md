# Phase B hospital records

Status: active (daily notification readers in draft)
Created: 2026-11-25
Updated: 2026-11-25

## Goal and success criteria

Prove one asymmetric Epic patient app in the sandbox, ship the companion settings early, and deliver at most one authorized notice for actual changes in a daily import. Each PR owns its evidence and deployment gate.

## Scope and tasks

1. **PR A (this change), registration and sandbox proof.** Web resolves the exact client ID for each environment at start, callback and refresh. Keep public, organization-approved and Basic readers while sessions or grants need them. Publish separate public key sets, exercise S256, code exchange and two rolling renewals with same-patient reads. Production activation is a separate owner decision.
2. **PR B, daily access and settings.** Preserve an existing offline grant against an insufficient replacement under the member lock. Fence malformed or revoked grants and monitor due lag. Ship the Web-owned, revisioned message preference and companion v2 projection. Default to notice, require separate affirmative detail consent, cancel pending delivery on off, reset to off on consent withdrawal. The owner chose processor approvals (B7). Use versioned per-entity entries in the existing consent ledger and gate replacement start, persistence, daily admission and hospital transport. Check fixed runner destinations and hosted model selection against the recipient table. Resolve the processor inventory before attestation.
3. **PR C, first iOS release.** Show actual grant, message switch and detail consent, plus one approval per named processor. Remove misleading additions counts from the display while keeping legacy fields. Ship independently of source deletion.
4. **PR D, durable private receipts (parallel to A).** Core commits a replayable result with the canonical write, including both empty paths. Read it before filtering on retry. Record meaningful changes with stable enrichment identity and preserve receipts across restore. Missing legacy evidence stays silent. Receipts accumulate in one file per run without pruning. Each all-skipped batch costs a canonical write and one row. Define a retention rule before daily checks run at volume.
5. **PR E, notification admission and delivery.** Only trust receipts for runs admitted after receipt writers are deployed everywhere. Replaying a batch committed by an older runtime can write an empty receipt that looks identical to a proven no-change result. After readers converge, publish one fenced mailbox pointer per eligible daily run. Bind to the captured credential epoch and preference revision. Plain notices use the ordinary outbox directly. Detail uses a scheduled turn with the private receipt pointer. Recheck current authority, pacing, quiet hours and direct iMessage transport at dispatch. Fixed notices require product access. Prove retry, revocation, empty imports and out-of-order enrichment.
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
approvals block the next hospital read. The owner classifies destinations by
who chooses them. OpenAI and four optional helpers can receive record-derived
content without a member selecting the recipient. The app requires an individual
approval for each. Member-directed destinations use the member’s own choice.
Audio attachment transcription is separate from hospital document processing.
The runner tests the fixed destinations and hosted inference selection against
the same table that supplies the app notices. Imported copies remain available
in the vault after withdrawal.

Before the owner attests in Epic:

1. Confirm from registration and deployment history that no replacement-profile connection was saved before the profile marker deployed. The client ID is inside the encrypted grant, so existing unmarked rows cannot be backfilled from control metadata.
2. Reconcile the published subprocessor list with the processor inventory.
3. Confirm which optional helpers are enabled in production and their deployed routes. Keep helpers that may receive hospital content individually named until their inputs are restricted.

The synthetic PostgreSQL test admitted a daily run with five current grants,
fetched a hospital page, withdrew one grant and observed no further hospital
request. Separate callback tests cover a withdrawal while SMART is open. Adding
a synthetic unknown runner host failed the classification test as intended.

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
and revocation during an actual model turn await the owner's channel decision and E2 delivery proof.

Replacement-profile notifications use B7’s current named approvals at proof, scheduling and egress. A terminal run that lost approval keeps its import outcome and suppresses the occurrence, including proofs received after reapproval. The companion app continues to show the approval requirement alongside the saved message setting.

### PR E2 · Admission and activation boundary

1. Pin a receipt-required retrieval protocol at admission on each eligible
   run. Web must enforce that version on every page and retry, and bind each
   enrichment job and restored checkpoint to it. Prove an older runner cannot
   import a batch or apply enrichment for that run through a legacy path,
   including after restore. This per-run fence suffices for receipt authority.
   Remove the fleet-attested migration marker from the design. Deploy all
   readers first so mixed fleets can make progress. Never backfill eligibility.
2. Under the daily admission lock, prove current named processor approvals,
   the replacement-client ongoing grant,
   an accepted baseline under the current credential epoch, the current message
   revision and exact verified private route. Freeze these on the new run.
   Keep admissions disabled until the chosen channel can send. Today a private
   checkpoint advances coverage to `scheduled` even if the intent fails or
   the job skips. Enabling admission earlier would consume the only occurrence.
3. The owner must decide whether clinical texts may use the member's ordinary
   Murph thread. Linq automatically selects iMessage, then RCS, then SMS and
   deprecated its service preference. It offers no iMessage-only guarantee
   for plain text. Keep clinical sends blocked pending this decision.
4. Bind every outbound effect of a detail turn to the accepted run, current
   policy and single recipient before allowing generation. Ordinary cron
   replies mint ordinary keys today. No code mints clinical per-bubble keys
   and those replies would bypass `clinicalEgressBlock`. Test revocation during
   generation, between bubbles, on alternate tools and on retry. Preserve
   the ordinary AI allowance rules. Demonstrate that the system-work path
   drains the fixed notice's `deliveryIntentIds` through actual outbox egress.
5. Defer an occurrence during quiet hours and persist its next safe wake.
   Recheck authority at that wake before sending. If the verified number
   is missing or its region has no supported window, hold silently until
   route information changes. Do not poll an unresolvable region or consume
   coverage for a quiet-hours deferral.
6. Roll back admissions first. Old runners strictly reject `changeRun` in
   persisted enrichment mailbox state and `clinicalChange` when parsing the
   whole cron store. Old Web rejects the notification `purpose` and checkpoint
   `kind`. Retain compatible Web, Worker and runner readers, the pinned receipt
   protocol, egress checks and durable coverage through outstanding work and
   restorable snapshots. E1 alone admits no eligible runs.
