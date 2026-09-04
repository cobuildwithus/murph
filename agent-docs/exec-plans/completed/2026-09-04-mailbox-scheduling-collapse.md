# Mailbox scheduling: one bounded retry owner

Status: completed

## Outcome and invariant

Eligible durable work must recover without another member message, mailbox append,
or successful release notification. Keep foreground priority, canonical ordering,
exact write fences, idempotent external effects, and legitimate provider deferral.
The primary design objective is clean, simple, maintainable, composable ownership.

## Evidence and scope

The prior source investigation found that accepting an already-running executor
can leave an exact mailbox pointer unimported after that executor exits. The
scheduler renews its same-pointer suppression indefinitely while facts remain
unchanged. A subsequent arrival breaks the suppression. Existing tests explicitly
expect the indefinite suppression; they need a behavior-level correction.

The progress monitor separately lets an arbitrary workspace wake postpone the
stall clock of an imported device item. An unrelated assistant checkpoint can
therefore clear an alert without completing its pending work. A device-wide wake
also does not, by itself, prove progress for each connection or mailbox item.

Some adjacent incidents were snapshot transport or metadata propagation failures.
This work does not claim to fix their underlying transport or payload causes.

Relevant open work belongs to other sessions: public PRs 2801 (retained device
wake ownership), 2815 (progress diagnostics), 2822 and private PR 112 (foreground
standby). Inspect their intended changes to avoid contradictory ownership. Do not
edit their branches or duplicate their patches.

## Existing owners and data flow

1. Web accepts encrypted mailbox work and owns access, dirty device state,
   canonical checkpoints, mailbox rows, and reconciliation facts.
2. The runtime imports ordered input, durably retains unfinished operations,
   executes eligible work, and checkpoints completion and future wake projections.
3. Cloudflare UserRunner owns the exact execution/write fence and the idempotent
   ensure-processing decision: start, replace, wake, or acknowledge an active run.
4. Temporal holds only pointers and bounded orchestration state. It reads facts,
   asks UserRunner to ensure execution, waits to the appropriate finite deadline,
   and reads facts again. Acceptance is not completion.

Receipt, durable transfer into a continuing operation, and terminal completion
remain distinct. Never advance a handled frontier across work without terminal
or durably retained evidence. Never retire a pointer merely because execution
was accepted. Explicit-null frontiers retire only the noncanonical scheduling
projection; omitted capability fields remain unknown under deployed-reader skew.

## Design decision to review

Prefer existing scheduling projections over a new generalized work-summary schema.
Current facts already carry the handled frontier, model-free/default ownership,
independent default and model-free deadlines, and system progress generation.
The demonstrated scheduler defect is a competing retry-owner exception, not a
missing generic job framework.

### A. Collapse system retry ownership in Temporal

For capability-complete facts, use the existing system-mailbox progress/backoff
gate for both exact mailbox pointers and model-free wake retries. Eliminate the
exact-pointer exemption from that gate in the new replay-versioned path. Preserve
one finite no-progress retry schedule, the active owner's recommended horizon,
fresh foreground preemption, and canonical pointer retirement.

Do not reconstruct completion from workspace version movement. Version changes
can prompt reconciliation, but cannot grant indefinite suppression or prove that
a particular obligation completed. Pure duplicate-signal bursts should coalesce;
they must not push an absolute recovery deadline farther into the future.

For genuinely deployed legacy facts lacking the capability fields, retain only
the necessary compatible fallback and make exact-pointer readmission finite too.
Carry deadlines across continue-as-new without resetting them. Missing carried
deadlines must trigger a fresh read and bounded readmission, never permanent idle.

Implementation choice to validate: can accepted owner horizon plus one progress
backoff entirely replace both suppression structures for current facts, without
repeated empty hot-runner wakes? Prefer deletion at this seam to another flag.

### B. Make monitoring honest about its evidence

Never let an assistant or unrelated wake reset an imported device item's age.
Choose the smallest correct rule against the existing mailbox/dirty-state owners:
use a deadline only when it is attributable to the affected obligation, otherwise
age from accepted-work evidence and report uncertainty conservatively. Preserve
legitimate future device retries and the earliest unimported work clock.

Before implementing, determine whether existing dirty-state/ack metadata proves
item-specific deferral without decrypting provider payloads or adding another
state owner. If it does not, do not label a lane-wide timestamp as per-item proof.
Evaluate explicitly separating delivery/import lag from durable retained-operation
health using existing authoritative evidence. Do not silently disable completion
monitoring, count an unrelated checkpoint as progress, or invent a new database
ledger solely to make the query easy.

### C. Clarify, consolidate, and delete

Document the runtime's two intentional views: what can run during this pass and
what must schedule a future pass. They may share primitives, but forcing identical
selection rules previously broke ordering and deferral. Preserve per-connection
serialization, foreground priority, and independently pending completion callbacks.

Delete overlapping retry-policy decisions on the current-capability path. Add no
new scheduler, queue, service, feature-specific workflow, generalized obligation
framework, or public schema unless a reproduced proof gap requires it. Any
necessary retained replay branch has a named removal condition in the private
runbook, rather than becoming permanent compatibility policy.

## State, failure, replay, and deployment

No initial public wire or database schema change is proposed. Runtime-owned durable
operations stay in encrypted checkpoint state; Web-owned product state stays Web
owned. Temporal remains pointer-only and UserRunner remains execution authority.

Changing command-producing branches requires a Temporal patch at the affected
execution path and replay against old histories. Preserve workflow names, signals,
queues, previous patch markers, and activity identities. Cover new, carried,
old-marker, omitted-capability, and continue-as-new histories. Do not terminate or
reset production histories. Remove obsolete branches only after supported histories
and reader versions are proven drained by the existing release owner.

Public monitoring changes and private retry changes should remain independently
wire-compatible. Keep mixed-version tests and exact private/public release gates.
The existing migration operator must select histories missing the new collapse
marker: its current progress-gate marker filter excludes already-affected runs.
Use the existing run-bound migration signal and Continue-As-New path; confirm
successor adoption rather than treating a successful signal as adoption proof.
Merge/deploy ordering will be finalized after plan review and implementation proof;
no unreviewed production mutation or manual history repair is part of this plan.
Rollback must retain support for any new patch markers observed by live histories.
Use protected release workflows and their existing current/ramping reader admission.

## Proof

- Reproduce an arrival after the runner's final import, accepted already-running
  result, lost release signal, runner exit, unchanged facts, and no new ingress.
  Require another real processing attempt within the existing bounded policy.
  Do not fabricate completion by changing a facts mock on a timer.
- Duplicate signal bursts coalesce; continuous signals do not extend the deadline;
  retries satisfy a rate ceiling; foreground work interrupts background waits.
- Cover active-owner horizons, stale/mismatched release notifications, durable
  completion, explicit-null versus omitted frontiers, blocked access, provider
  deferral, processing failure, checkpoints, and continue-as-new restoration.
- Run workflow tests and real Temporal replay/time-skipping tests. Keep the old
  no-readmission behavior only where required to replay old recorded histories.
- Run real PostgreSQL monitor proof: unrelated assistant wake, another device's
  retry, legitimate future deferral, unimported later rows, malformed frontier,
  usage-paused conversation work, and inactive access. Verify exact query output,
  not just SQL-string snapshots.
- Run focused public tests and affected package/app typechecks; private `pnpm
  verify`; authored JS/TS complexity guard and diff/privacy review. CI owns broad
  public exact-head coverage and cross-repository compatibility proof.
- Review the implementation's complete diff and complexity. Start required final
  ReviewGPT immediately once each exact pushed merge candidate is ready, alongside
  CI. Resolve applicable findings according to the repository workflow. Merge only
  after required checks/reviews, then retire clean inactive task worktrees.

## Work sequence

- [x] Recover prior task and source findings; inspect current heads and open PRs.
- [x] Establish an isolated task checkout and write this architecture-first plan.
- [x] Ask latest ReviewGPT 0.5.145 with GPT-6 Pro to critique this plan and suggest
  a materially simpler architecture; validate the captured model identity.
- [x] Record accepted/rejected design advice, settle the monitoring evidence seam,
  and implement the smallest complete collapse across the existing owners.
- [x] Run focused direct proof, typechecks, replay, complexity and candidate review;
  disclose the local maximum-cardinality fixture limitation below.
- [x] Commit/push scoped PRs and finish required reviews alongside CI.
- [x] Close the implementation plan with proof limits and release responsibilities.

Landing gate: require green final-head CI, prove current-base mergeability, merge
both authorized PRs, then retire clean inactive worktrees. PR records and the
completion report carry the eventual merge/CI outcome; this closed plan records
the reviewed implementation without claiming pending checks or deployment.

## Review questions

1. Does this plan remove the causal complexity, or merely bound one symptom?
2. Can the existing owner horizon and progress fuse replace every competing current
   system suppression state? Which exact invariant requires any remaining state?
3. Is a new runtime scheduling summary necessary today? If yes, show the failing
   case that the existing projections cannot express and the smallest replacement.
4. How should monitoring distinguish received input and retained work with current
   durable evidence, without arbitrary wake clocks or a new generic ledger?
5. What is the smallest replay-safe migration and meaningful end-to-end proof?

## Progress

Latest ReviewGPT 0.5.145 reviewed the plan with GPT-6 Pro. The exported thread
metadata confirms `gpt-6-pro`; the complete response ended in the requested
completion marker. The capture validator rejected duplicate model-confirmation
lines (one prompt-specified, one tool-generated), so this is manually verified
advisory evidence, not a final implementation gate PASS.

Accepted advice: retain current facts and boundaries; collapse exact-pointer
retry ownership into the progress gate; age unhandled mailbox work from acceptance
without claiming retained-operation completion; prove no-ingress recovery, signal
coalescing, deadline carry, and explicit migration adoption. No new work-summary
schema, operation-health ledger, or parallel scheduler is justified.

The monitor now removes the arbitrary workspace-wake clock and unused supporting
query. Five focused PostgreSQL tests pass, including unchanged age across imports,
checkpoint changes, unrelated deadlines, and genuine frontier advancement.
The isolated database has current migrations; no shared or production schema was
changed. The pre-change maximum-cardinality test timed out after 240 seconds;
the five other baseline PostgreSQL tests passed. Recheck the changed query's
maximum-cardinality behavior before delivery.

Temporal now uses one current-capability progress gate and a finite legacy-facts
fallback, retaining the accepted horizon and absolute deadlines across rollover.
Adversarial facts-read tests exposed starvation from duplicate admission hints.
The implementation preserves signal wake semantics while preventing identical
pointers from repeatedly discarding usable facts. Legacy marker histories retain
their recorded policy; the new deployed-combination replay fixture passes.
Real Temporal no-ingress recovery, full verification, and final review remain in
progress. No production state or deployed configuration has changed.

Public candidate proof: 16 unit tests and all five focused PostgreSQL behavior
tests pass. The full PostgreSQL run repeats a baseline setup failure: the
20,001-row lane-counter fixture insert reaches its 180-second statement timeout,
before the monitor query. Maximum-cardinality execution is therefore unverified
locally; the production query's cardinality contract is unchanged and its unused
lateral read is removed. Web typecheck passes after building the existing
`device-syncd` dependency. Complexity guard passes with no hotspots above 20.
Parent review confirms the public diff changes only monitoring and its contract;
changelog is not applicable to this operator-only outcome.

Both real Temporal no-ingress cases pass using a local server and simulated
processing Activities (complete and legacy facts), with no new mailbox arrival
and one simulated effect. This proves scheduler admission and settlement, not a
new end-to-end UserRunner/device-provider claim. Full private verification and
final exact-head reviews remain pending.

## Implementation review and remediation

Public PR 2831 passed final GPT-6 Pro review on `f7f4cc8d76fa696c72e22b593e75435a3a8f2260`:
https://chatgpt.com/c/6a9b4544-8974-83ea-96db-41ce6e0fb1e4.
The captured response and model-verification artifacts match that exact target
and report zero findings. The 6-minute-36-second capture was accepted under the
review runbook's near-threshold discretion: substantive full changed-file and
caller/owner inspection, verified source hashes, exact model and completion
marker. Required public CI passed. The existing operator panel also consumes the
corrected age; it now reports acceptance time for the unhandled head. Its separate
legacy/device remediation gates and authenticated actions remain unchanged.

Private PR 113's one-time GPT-6 Pro specialist review found SP-001 (P2): losing
complete progress capability facts discarded a future accepted deadline. Parent
regressions reproduced readmission at zero seconds in one run and five seconds
after rollover, instead of the accepted 90-second horizon. The correction hands
that deadline to the existing finite fallback after canonical pointer resolution.
Available handled/generation progress, retired pointers, and expired deadlines
prevent stale transfer; earlier workspace wakes still trigger fresh facts.
Restoring complete capabilities carries the same deadline back to the progress
gate. This adds no durable shape, new owner, or public capability protocol.

Private final round 1 returned PASS on `6a734ec99db51e8ebae34ef89364015081b4c3a6`
after about nine minutes, but did not override the separately reproduced
specialist finding. Corrected head `980e39564254eaf844e09f583a0755a67cd34371`
has 393 passing workflow/replay tests and a passing typecheck. Final round 2
returned PASS with zero findings after about nine minutes, concurrently with CI:
https://chatgpt.com/c/6a9b4bce-48a4-83ea-9d83-398eccafa301.
The tool opened a fresh full-snapshot thread; its verified metadata preserves the
exact current, first, and previous reviewed heads. Capture/model evidence confirms
`gpt-6-pro` and the terminal marker. The reviewer independently reproduced the
old failure and corrected 90-second admission in both transition cases; its
offline machine harness is additional evidence, not a claimed Vitest/replay run.
The preliminary review was not repeated. SP-001 is resolved by parent proof and
final review; no accepted finding remains.

The first local private `pnpm verify` failed two existing deployment-controller
cleanup timing expectations. First-head CI verification passed. The corrected
candidate's full local verification is running; no local failure is represented
as a pass. Real Temporal admission/rollover evidence remains bounded to simulated
execution and canonical effects, as described above.

Landing and production adoption are separate. The public monitor and private
scheduler are independently wire-compatible. Landing requires their final CI and
review gates; production release and the protected run-bound migration remain
operator work. Confirm successor histories contain the new marker after release;
no deployment, production signal, history reset, or database mutation was made.
Updated: 2026-09-04
Completed: 2026-09-04
