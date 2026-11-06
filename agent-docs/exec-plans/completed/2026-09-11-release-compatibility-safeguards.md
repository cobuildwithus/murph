# Verify incident recovery and enforce cross-plane release compatibility

Status: completed
Created: 2026-09-11
Updated: 2026-09-12

## Goal

- Restore the affected scheduled-delivery and runtime-log paths, verify the actual
  production outcome, and prevent independently deployed components from activating
  an incompatible protocol pair.
- Explain the causal chain and the gaps in test, release, and recovery coverage in
  a thorough retrospective after recovery is verified.

## Success criteria

- The canonical production Web and runner releases satisfy their declared protocol
  dependencies; managed-container smoke and live release verification pass.
- Fresh natural production observations establish whether the two incident symptoms
  have stopped and whether the affected delivery/logging paths complete successfully.
- Synthetic composed proof reproduces the incompatible old/new pair and demonstrates
  that the chosen safeguard rejects it before activation while admitting supported pairs.
- Prevention has focused verification, parent review, required external review, and
  final-head CI. Any temporarily interrupted unrelated CI is restored or superseded
  by valid current-head proof.

## Scope

- In scope: authorized canonical recovery rollout; remaining causes of the incident;
  deployment compatibility and release-admission owners; causal retrospective;
  narrowly scoped systemic prevention and its tests/documentation.
- Out of scope: a new deployment platform, incident tracker, compatibility state
  database, guessed route audience, automatic message replay, unrelated product work,
  and device-provider investigation.

## Constraints

- Web owns audience and accepted runtime-log contracts; the Worker and runner consume
  those contracts. Private Murph Cloud owns protected production deployment.
- Reuse existing release metadata, signed admission/smoke boundaries, and test owners.
  Prefer enforcing ordering or deriving evidence to adding another authority.
- Do not relax production authentication, current-member authority, write fences,
  required release proof, or rollback floors to make a deploy pass.
- Keep private incident evidence outside public source and fixtures. Use synthetic
  examples for code, tests, plans, and public review packets.
- One original task owns recovery and completion. Preserve other worktrees and PRs.

## Risks and mitigations

1. A new runtime reaches an older Web consumer.
   Mitigation: verify the real production Web dependency before runtime activation;
   preserve the passed candidate checks while holding its production job if necessary.
2. CI proves only components built from the same revision.
   Mitigation: exercise the real deployed/candidate boundary and every supported
   mixed-version pair relevant to the changed contract.
3. Queueing consumes a release proof's bounded execution window.
   Mitigation: distinguish queue, build, test, token, and settlement budgets in the
   retrospective; prove the smallest correction at the existing controller owner.
4. A universal compatibility layer introduces more state or blocks safe rollouts.
   Mitigation: inspect existing owners first; require concrete reproduction and
   successful supported-pair tests before choosing a mechanism.

## Tasks

1. Complete recovery through the protected workflows and verify live versions,
   telemetry ingestion, and scheduled-delivery outcomes. Continue remediation if
   the deployment does not resolve the established symptoms.
2. Preserve a sanitized chronology, producer/consumer source evidence, exact gate
   behavior, and the distinction between proximate cause and contributing conditions.
3. Inspect the current deployment admission, smoke, and cross-repository proof
   mechanisms. Identify why they allowed the incompatible pair and why recovery stalled.
4. Propose the smallest owner-level safeguard and reproduce its absent behavior with
   synthetic data before implementation. Use ReviewGPT for substantive implementation.
5. Implement the accepted prevention, meaningful regression proof, and durable owner
   documentation. Prepare the retrospective without publishing private evidence.
6. Complete focused checks, scoped commits, parent review, final ReviewGPT and CI;
   restore interrupted CI and verify the final authorized rollout where applicable.

## Decisions

- Existing prose already requires consumer-first deployment and mixed-version proof.
  Additional prose alone cannot close a missing executable release gate.
- Existing source-extraction checks reproduce an older Web authority response without
  audience scope and an older strict log reader rejecting a new event value. The
  correction must preserve the canonical audience owner rather than invent a fallback.
- A successful Worker release receipt proves that execution-plane release, not the
  compatibility of the independently served Web revision.
- The prevention candidate adds signed, bounded evidence from the served Web's
  actual log parser and audience-response builder at the existing deployment
  activation seams. It preserves independent source revisions and canonical
  audience authority. The additive Web endpoint must ship before the new CLI.
- The introducing audience change explicitly tested an absent field as a retryable
  scheduling failure; the Worker adapter separately accepted the legacy response.
  These are valid local contracts but do not prove availability of the composed
  deployed pair. Its rollout instructions already required Web before consumers.
- The new diagnostic event was likewise documented as rejected by an older Web
  reader. Keeping processing independent of logging avoided a processing failure,
  but did not make the observation path compatible or verify its ingestion.
- The production-core release suite selects Linq delivery/reminders, browser smoke,
  and two foreground partitions. The full private manifest's `telegram` alias
  resolves to first-contact proof; it does not select the separately registered
  Telegram scheduled-reminder scenario. Ordinary Cloudflare Node suites exclude
  E2E files. Adding a scenario to the public registry alone is not CI ownership.
- A synthetic clock against the real compatibility controller reproduces recovery
  cancellation: twenty minutes queued followed by twenty minutes executing exhausts
  the forty-minute total deadline, even when a bounded twenty-five-minute execution
  would finish inside the separate token budget. No network or production mutation
  is needed for this proof.
- Parent inspection caught forbidden cross-application test imports and a
  header-case typing error in the initial protocol candidate. Remediation keeps
  proof at each application owner and joins them through public contracts and
  synthetic wire shapes. The resulting candidate passes 72 Cloudflare tests,
  14 Web tests, both application typechecks, the shared package build, and
  workspace boundary verification.
- The timeout implementation derives usable proof time from the existing token
  boundary minus settlement reserve, and carries the absolute deadline through
  finalization and cancellation. Parent source review and all 75 controller tests
  pass under the repository's Node runtime, including queue-heavy successful
  execution, late finalization, and bounded cancellation settlement.

## Causal retrospective

- **Trigger:** independently deployed producers began requiring or emitting wire
  values that the serving Web consumer did not yet supply or accept. The runtime
  correctly refused to guess audience scope, while the strict log reader
  correctly rejected an unknown event. Their combination caused unavailable
  scheduled delivery and missing diagnostic ingestion.
- **Why component tests passed:** the authority tests deliberately proved that a
  missing audience defers work, and parser tests proved strict validation. Those
  local guarantees are necessary, but neither guarantees that a release will
  reach a consumer that satisfies the new obligation. Tests built from one
  checkout also cannot establish the behavior of an older deployed Web.
- **Why release checks missed the pair:** consumer-first guidance existed, but
  the Worker activation owner did not require executable evidence from the
  serving Web. Artifact smoke and container convergence attested a different
  boundary. Temporal mixed-reader checks were present, but cover orchestration
  facts rather than these runtime callbacks. Passing one compatibility proof
  must not be treated as universal compatibility.
- **Why journey coverage was incomplete:** the Telegram first-contact alias did
  not include the registered scheduled-reminder scenario. A test file and a
  public scenario registry entry are not proof that protected CI runs the journey.
  Required cross-repository coverage and its selected manifest must agree.
- **Why recovery took longer:** a fixed proof timeout charged queue and build
  time against execution despite a larger existing credential budget. Separately,
  requiring a new public scenario before its private manifest update blocked
  newer proof, and private-head movement correctly invalidated a prior pinned
  proof. A subsequent exact-candidate admission passed in GitHub while its
  imported Vercel check remained running; a check retry remained queued. The
  vendor synchronization cause is unproven. These delayed recovery; they did
  not cause the original wire mismatch.
- **Prevention:** enforce a live consumer prerequisite at activation, test
  supported and rejected mixed-version wire shapes at their real owners, retain
  positive downstream delivery and log-ingestion evidence, and keep proof plus
  cancellation inside one explicit credential budget. Scenario prerequisites
  must be deployed in consumer-first order across repositories too.
- **Limits:** bounded live samples do not establish global atomic deployment or
  prevent a later independent rollback. The audience and event witnesses do not
  certify every opposite-direction Web-to-runtime contract. Preserve their
  specific rollout floors and report missing natural-traffic proof honestly.

## Implementation and proof checkpoint

- PR #3349 merged the serving-consumer activation gate and shared release deadline
  after focused proof, independent final review, and all required CI passed.
  The canonical Web and a newer container release now serve the compatible
  versions. The protected deployment passed convergence verification; fresh
  production evidence confirms restored diagnostic ingestion and no recurrence
  of the two established protocol errors in the observed window.
- Enabling the existing Telegram reminder journey exposed a stale scripted tool
  payload. The fixture still supplied raw ISO `schedule.at`, while the current
  model-facing tool requires `schedule.localAt`. The future-wake assertion caught
  the failed save despite the scripted setup acknowledgement.
- PR #3357 isolates the fixture repair. Replaying its actual generated arguments
  through the production parser rejects the old shape and admits the repaired
  shape, including minute and year-rollover boundaries. Required CI passed and
  the fixture merged. Full protected integration now executes the fixed public
  source. Both scheduled-Telegram tests subsequently passed through the actual
  alarm, runtime and provider stub, including direct and group delivery without
  manual nudges.
- Full private integration intentionally resolves public main rather than an
  arbitrary candidate override. The correct prerequisite order is fixture repair,
  private selection and successful hosted proof, then public requirement #3350.
  Requested source inputs alone are not proof of the source a workflow executed.
- The private selection preserves the existing five production-core receipt names.
  Its local verification, preliminary specialist review, and final external review
  passed with valid tool attestations. The actual selected Telegram journey passed
  in three protected full runs. The final full integration passed all fourteen
  scenario lanes and the final aggregate. After the prior current-revision
  production admission passed, private selection #140 merged first and public
  requirement #3350 merged afterward. Both retained their reviewed heads and
  passing required checks; no production proof was invalidated by that sequence.
- Full integration found a second fixture mismatch after the separately merged
  signed-direct Linq ingress change. Its current contract trusts explicit signed
  directness unless durable group ownership contradicts it. The older composed
  fixture expected provider refresh before any group route existed. PR #3379
  uses absent directness for initial canonical group discovery, then a conflicting
  direct flag for a guest after group-route creation. It retains every mailbox,
  private-context and provider-delivery outcome assertion. Existing planner and
  fixture-builder suites pass. Required CI passed, the correction merged, and
  the actual protected Linq webhook lane subsequently passed all nine tests.
- The next full run passed thirteen scenario lanes but exposed an overstrict
  fairness checkpoint observer. Production permits a completed pass with zero
  processed jobs; the observer accepted only yielded empty passes. PR #3387
  accepts both legal intermediate outcomes while retaining the positive-pass
  target, original deadline, single admission, exactly-once reminder, durable
  unfinished backlog, and eventual full-drain assertions. A fifteen-case replay
  executes the actual observer and production classifier, reproduces the old
  failure, and preserves failure/deadline rejection. Required CI passed and the
  correction merged. A new protected full run on the reviewed private selection
  passed all fourteen scenario lanes and the aggregate. The completed runner
  build confirms the merged public correction. The available failed-run artifacts
  do not establish why that particular empty pass occurred.
- Test registration, selection, successful setup and downstream completion are
  separate facts. The final testing owner documents each gate and its trigger,
  including the distinction between private full integration and public
  production-core admission.
- Existing Frog records already cover delayed Draft events superseding Ready CI
  and narrowed shared fetch refspecs leaving tracking refs stale. Use a fresh Ready
  event after stale event settlement and fetch the base with an explicit destination
  ref; do not modify unrelated shared fetch configuration.
- The temporarily interrupted checks for PRs #3341, #3339, and #3342 were
  restored by their owners. All required checks pass and the PRs have merged.
- The task-owned Telegram and Linq Frog entries were committed with their owning
  changes; the existing fairness entry was updated and committed with PR #3387.
  All executable follow-ups have merged and the cross-repository proof is complete.

## Verification

- Recovery: protected workflow job receipts, canonical production alias/deployment
  metadata, exact live Worker/container provenance, bounded fresh failure searches,
  and positive completion/ingestion observations.
- Prevention: 72 Cloudflare admission tests, 14 Web protocol tests, 75 release
  controller tests, applicable typechecks, shared build, workspace boundaries,
  complexity and document guards passed before #3349 merged with required CI
  and final independent review.
- Selection: all seven public cross-repository coverage tests and all sixteen
  private planner tests passed. The private verification suite and applicable
  independent reviews passed. Public #3350 passed all four required checks and
  final review before its normal protected merge.
- Composed outcome: the final protected full run passed all fourteen scenario
  lanes and the final aggregate against the exact reviewed private selection
  and public source containing all three fixture prerequisites. This includes
  actual direct/group scheduled Telegram delivery, Linq isolation and reminder
  progress during device backlog. The fifteen-case source replay separately
  covers legal empty device passes and failure/deadline rejection.
- Production: the compatible Web is promoted; protected container releases have
  converged. Repeated bounded observations show accepted processing summaries
  and no recurrence of the two established protocol errors. Natural outbox sends
  do not bind every historical scheduled intent to a provider receipt. Expired
  reminders were not replayed; the vendor check synchronization cause remains
  unproved.
- Completion: temporarily interrupted unrelated CI was restored; all executable
  follow-ups merged. This explanatory closeout uses document checks and parent
  review; its final required CI and merge receipt remain recorded on the PR.
Completed: 2026-09-12
