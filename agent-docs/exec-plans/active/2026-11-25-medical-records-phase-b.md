# Phase B hospital records

Status: active (locked admission merged, private delivery in review, production dispatch closed)
Created: 2026-11-25
Updated: 2026-11-25

## Goal and success criteria

Prove one asymmetric Epic patient app in the sandbox, ship the companion settings early, and deliver at most one authorized notice for actual changes in a daily import. Each PR owns its evidence and deployment gate.

## Scope and tasks

1. **PR A (this change), registration and sandbox proof.** Web resolves the exact client ID for each environment at start, callback and refresh. Keep public, organization-approved and Basic readers while sessions or grants need them. Publish separate public key sets, exercise S256, code exchange and two rolling renewals with same-patient reads. Production activation is a separate owner decision.
2. **PR B, daily access and settings.** Preserve an existing offline grant against an insufficient replacement under the member lock. Fence malformed or revoked grants and monitor due lag. Ship the Web-owned, revisioned message preference and companion v2 projection. Default to notice, require separate affirmative detail consent, cancel pending delivery on off, reset to off on consent withdrawal. The owner chose processor approvals (B7). Use versioned per-entity entries in the existing consent ledger and gate replacement start, persistence, daily admission and hospital transport. Check fixed runner destinations and hosted model selection against the recipient table. Resolve the processor inventory before attestation.
3. **PR C, first iOS release.** Show actual grant, message switch and detail consent, plus one approval per named processor. Remove misleading additions counts from the display while keeping legacy fields. Ship independently of source deletion.
4. **PR D, durable private receipts (parallel to A).** Core commits a replayable result with the canonical write, including both empty paths. Read it before filtering on retry. Record meaningful changes with stable enrichment identity and preserve receipts across restore. Missing legacy evidence stays silent. Receipts accumulate in one file per run without pruning. Each all-skipped batch costs a canonical write and one row. Define a retention rule before daily checks run at volume.
5. **PR E, notification admission and delivery.** Only trust receipts for runs pinned at admission to a receipt-required retrieval and enrichment protocol. Replaying a batch committed by an older runtime can write an empty receipt that looks identical to a proven no-change result. After readers converge, publish one fenced mailbox pointer per eligible daily run. Bind to the captured credential epoch and preference revision. Plain notices use the ordinary outbox directly. Detail uses a scheduled turn with the private receipt pointer. Recheck current authority, pacing, quiet hours and the frozen verified private route at dispatch. Fixed notices require product access. Prove retry, revocation, empty imports and out-of-order enrichment.
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
   Keep admissions disabled until the chosen channel can send. A private
   checkpoint leaves coverage at `published`. Activation must advance coverage
   only on a real provider attempt and preserve a blocked or skipped occurrence.
3. Send on the exact verified private thread frozen at admission. The owner
   withdrew the iMessage-only requirement. Linq may choose iMessage, RCS or
   SMS. Render the notice privately without a source name. The existing
   explicit detail setting authorizes detail on that thread.
4. Bind clinical outbox replies to the accepted run, current policy and frozen
   private thread. Recheck before generation, after generation, between
   bubbles and on retry. Preserve ordinary AI allowances and helpers.
   A detail turn has the same shell and network reach as any scheduled turn,
   bounded by the Worker’s existing messaging-operation check. The clinical
   per-bubble checks cover the reply path only.
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

**Reader rollout (draft #5318).** The owner accepts signed outbound receipt
text passing through Web memory on the ordinary webhook. Web verifies it,
drops echoed message parts for every receipt and suppresses clinical provider
prose before storage, logging, tracing or orchestration. Ordinary receipts
retain sanitized provider diagnostics. Web accepts uncorrelated receipts and
clears both reasons if a pending clinical dispatch matches the chat, or if
the receipt omits the chat ID and any clinical dispatch is pending. The Web retry owner excludes
clinical deliveries using the existing delivery template. A definite terminal
failure consumes the attempted occurrence. This avoids fetching private text
or generating a second message after a provider attempt.

Web, the hosted runtime and the manually deployed Cloudflare port can read
the receipt-required protocol. The run, page, document and outcome protocols
must agree. The protocol travels in private checkpoints, batch manifests and
enrichment jobs. Ordinary imports continue on v2. Publication remains on the
run row. A private checkpoint, including one from an older runner, cannot
advance coverage. The daily writer still has no path to pin or admit a
notification. Deploy Web, then the hosted runtime, then Cloudflare manually
from main. Keep all three compatible readers through outstanding work and
restorable snapshots once the first pinned run exists.

A synthetic restore opened the new on-disk state with the E1 checkpoint and
enrichment readers from the previous head. Both rejected the pinned work.
The current readers restored that checkpoint and applied the prepared job.
The webhook-owner tests check echoed text against writes, traces, logs and
the Temporal handoff. The PostgreSQL retry test checks the persisted clinical
marker and zero provider reads or replacement sends after a terminal failure.

**Activation split, locked Web writer.** The first draft ends at run creation
and pointer publication. The production sweep supplies no reader revisions.
It can establish a baseline but cannot create an eligible run, publish a
notification or spend an occurrence. The nullable connection column records
the credential epoch on an accepted complete, whole-history outcome. A new
epoch needs its own baseline. Under the member lock, the daily writer requires
the ongoing replacement grant, current named approvals, matching baseline and
reader revisions, enabled preference and verified direct route. It pins the
receipt protocol in the same insert as the epoch, revision and fingerprint of
the approved notice versions and route. Old runs receive no updates. Roll out
the additive migration before Web. This half has no public changelog entry.

The gated local PostgreSQL suites and production migration guard passed
249 tests across six files. They exercise all three modes through the daily
writer, late enrichment after a second daily admission, recovery on a full
catch-up and the silent production sweep. Web retrieval passed 96 tests,
and the callback and sweep routes passed 24. The deterministic private
staging suite passed its three cases. The live assistant selector has no
registered daily notice, detail or off journey at this head.

Follow-up verification accepts a zero-page whole-history baseline only after
Web validates the terminal outcome against the frozen slices and its page count.
A real replacement SMART callback increments the credential epoch. The next
daily run stays silent until the new epoch has a baseline. If a member changes
the setting or withdraws approval after eligibility is checked, PostgreSQL
serializes the change behind the run insert. The decision reader then refuses
the frozen pin. The mocked admission suite now preserves real consent exports
and runs all 13 tests.

**Private delivery draft.** The ordered system mailbox stages the fixed notice,
publishes the workspace checkpoint and drains the exact outbox intent through
ordinary provider entry. It can recover that intent by run key. The detail job
uses the direct scheduled audience, the private receipt reference and a stable
run key. A completed one-shot stays disabled in the private cron store so a
replayed change pointer cannot schedule it again. Leading and final bubble keys
are checked again before entering the outbox, recognized at Web’s dispatch
fence and excluded from terminal retry. A downgrade between bubbles leaves
only the already staged reply. The three-mode synthetic journey passed with
a developer-local subscription.
An ordinary route response from Web or a port that drops the clinical
acknowledgement cannot authorize generation or delivery. Production Web issues
no acknowledgement and the daily sweep supplies no release evidence.

**Remaining activation review.** This split isolates private mailbox checkpoint,
cron replay and outbox changes from the production authorization transaction and
release authentication. The boundary is Web’s signed egress response. Complete
all of the following before the first production admission.

1. Authenticate compatibility evidence for the serving runner and the manually
   deployed Cloudflare port, including mixed releases. The production sweep
   supplies this evidence and admission verifies it under the member lock. An
   old or missing reader leaves the new run on v2. The current caller-supplied
   revision constant cannot attest either release.
2. Authorize clinical replies in Web only for the accepted, receipt-proved run,
   matching credential epoch, replacement ongoing grant, current OpenAI approval,
   preference revision and exact frozen private route. Preserve proactive pause
   and line health. Account for the occurrence on a real provider attempt,
   reconcile lost or ambiguous handoffs, and allow the remaining bubbles of the
   same authorized turn. A definite terminal failure consumes the attempt.
3. Persist the next safe regional wake for quiet hours, hold missing or
   unsupported regions without polling and recover on a route change. Preserve
   blocked, deferred and skipped occurrences, including a private outbox or cron
   preflight that would otherwise retire the only copy. Recheck at the wake.
4. Exercise all three settings through production admission and synthetic
   delivery together, with mixed serving revisions, late enrichment, empty
   receipts, restore, withdrawn approval, reconnect, removal, route changes,
   opt-out during generation, downgrade between bubbles, health and quiet-hour
   recovery, and terminal failure. Verify every supported attachment or fallback
   reply retains its clinical key and exact recipient. Add the public changelog
   when registration alone can enable delivery.

Deploy the additive baseline migration before Web, deploy compatible Web and
runner readers, then the Cloudflare port manually from main. Enable admissions
last. Roll back admissions first. Keep compatible decision, receipt, cron,
checkpoint and egress readers, retry exclusion and durable coverage through all
outstanding work and restorable snapshots after the first pinned run.
