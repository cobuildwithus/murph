# Phase B hospital records

Status: active (E1 merged, E2 activation on hold)
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
   Keep admissions disabled until the chosen channel can send. A private
   checkpoint leaves coverage at `published`. Activation must advance coverage
   only on a real provider attempt and preserve a blocked or skipped occurrence.
3. Send on the exact verified private thread frozen at admission. The owner
   withdrew the iMessage-only requirement. Linq may choose iMessage, RCS or
   SMS. Render the notice privately without a source name. The existing
   explicit detail setting authorizes detail on that thread.
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

**Activation change.** Before enabling the daily writer, implement locked
baseline, grant, named approval, epoch, revision and route admission, the
per-effect detail and private provider authority checks, model-free notice
drain, coverage at the provider attempt and quiet-hours retry. Exercise all
three settings against the real admission path. Roll back by stopping new
admissions first and retaining those readers, authorization checks, retry
exclusion and durable coverage through the restore horizon.

Activation must also close these replay and deployment hazards.

- Every detail bubble must carry a production-minted `clinical-change:`
  idempotency key. Exercise those actual keys at the Web dispatch fence and
  verify the resulting template excludes every bubble from terminal retry.
- A restored wake can read `published` again. The notice key deduplicates its
  intent, but the one-shot detail job disappears after execution
  (`keepAfterRun: false`). Prove that replay after checkpoint and after job
  removal cannot start a second detail turn for the same run.
- The strict notice decision lost `directoryLabel`. Mixed versions reject
  notice decisions in either direction. Keep the eligibility writer closed
  until Web, hosted runtime and the manually deployed Cloudflare port all
  support the decision shape from this reader rollout.
