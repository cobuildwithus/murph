# Verify incident recovery and enforce cross-plane release compatibility

Status: active
Created: 2026-09-11
Updated: 2026-09-11

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

## Verification

- Recovery: protected workflow job receipts, canonical production alias/deployment
  metadata, exact live Worker/container provenance, bounded fresh failure searches,
  and positive completion/ingestion observations.
- Prevention: focused tests invoking production admission/parser owners with synthetic
  old/new combinations, applicable typechecks, complexity and document guards, then
  required CI and independent review. Select exact commands after locating the owner.
