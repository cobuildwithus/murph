# Phone-call result policy reader prerequisite

Status: active
Updated: 2026-08-15

## Goal

Land and deploy the additive reader half of the encrypted phone-call result
policy evolution before PR #1351 can write that policy.

Success means:

- current Web accepts both legacy encrypted results and the one bounded
  `transfer_follow_up_required` policy;
- this prerequisite does not emit policy-bearing ciphertext for tracked,
  manual, or group calls;
- the previous strict reader's rejection of the new field is captured as an
  explicit mixed-version fixture;
- production rollout keeps all writers on legacy absence until the compatible
  reader is live, prior Web route invocations have drained, and pre-reader
  deployment-pinned reconciliation Workflow runs have settled; and
- focused tests, affected typechecks, exact-head CI, and ReviewGPT pass.

## Evidence

- ReviewGPT round 16 for PR #1351 proved that the new reader accepts legacy
  absence but the previous strict schema rejects policy-bearing plaintext.
- The writer path is shared by scheduled, manual, and group transfers, so a
  `result_notification_channel IS NOT NULL` count cannot prove encrypted-result
  rollback safety.
- Current `main` already carries transfer follow-up as a transient boolean but
  persists only the legacy three-field result shape. Adding reader acceptance
  alone therefore creates the required consumer-first deployment without a
  flag, compatibility shim, second representation, or new state owner.
- The preliminary specialist found that syntactic acceptance alone was not a
  safe rollback floor: stored recovery on the reader-only release would parse
  a future policy but still derive required-send behavior only from the lost
  transient boolean. The accepted correction makes the existing notification
  owner derive one trusted value from either source while leaving the producer
  policy-free.
- Final ReviewGPT round 2 accepted that semantic correction but required a
  retrospective because the rollout prose incorrectly promoted this
  policy-free producer to the permanent post-write rollback floor.
- The installed Workflow SDK records a deployment id on every run, defaults
  `start()` to the current deployment, and routes later steps back to that
  deployment. Production inspection currently reports no pending or running
  phone-call reconciliation runs, and the same authenticated query can prove
  the pre-reader drain after deployment.
- Both Assistant and Web group normalization force `allowTransferToUser` to
  false. Only tracked and generationless manual direct transfers are admitted
  producers for this policy evolution.

## Implementation

1. Extend the shared strict result reader with the optional bounded policy and
   make the existing notification owner honor it without activating a writer.
2. Add mixed-version schema proof: legacy plaintext remains readable by the new
   reader, the new policy is bounded, and the previous strict reader rejects it.
3. Pin the current transfer producer proof to legacy absence.
4. Document the reader-first deployment, old-invocation drain, and rollback
   floor that PR #1351 must reference before activating the writer.

## Invariants

- Encrypted `HostedPhoneCall` result storage remains the sole result owner.
- This prerequisite writes no new value. It extends accepted input and makes
  the existing notification owner honor that future durable value during
  stored recovery.
- Current legacy producer behavior remains unchanged until the later writer
  activation.
- No database column, migration, queue, scheduler, flag, callback, or alternate
  result representation is introduced.

## ReviewGPT round 2 retrospective

The original requirement is a consumer-first strict-schema release that keeps
current behavior unchanged until PR #1351 activates the writer and establishes
a safe rollout contract for the first policy write.

The first-reviewed head `0d6ce3f76cbaafdfa024e986a1c0829290fe1e76`
added the bounded reader field, mixed-version strict-schema proof, legacy
producer-absence proof, and deployment prose. The current head
`f24bd3b59415f459cb4620332da4881c305cb333` adds one review-driven derivation in
the existing notification builder plus stored-recovery coverage: either the
current transient boolean or future durable policy now produces the same
required-send obligation. Encrypted `HostedPhoneCall` result storage and the
assistant-notification mailbox remain unchanged owners; no new state owner,
queue, scheduler, lifecycle, compatibility path, or recovery mechanism was
introduced.

The repeated mechanism was reliance on invocation-local transfer state. The
semantic consumer correction removes that dependency for policy-bearing rows,
but the old rollout prose would have recreated it by serving this legacy-only
producer after writer activation. The continuation decision is to retain the
small consumer correction and reader/writer split, delete the overstated
rollback claim, and narrow the admitted producer surface. This PR is only the
consumer prerequisite. PR #1351 is the first reader-plus-writer release and is
the post-write operational floor. Tracked and generationless manual direct
transfers are in scope; group transfer is unreachable and excluded.

First-write safety requires two independently proved drains after the reader
alias is current: every ordinary Web route invocation from an older deployment
has exceeded the platform's full configured function lifetime, and the
Workflow inspector reports no pending or running
`hostedPhoneCallReconciliationWorkflow` pinned to a pre-reader deployment.
Vercel pins a Workflow run to the deployment that starts it, so elapsed route
lifetime is not Workflow proof. Any emergency rollback below the later writer
floor must pause new phone-call admission while the current writer and
analyzed-webhook ingress drain every result-capable provider call and
deployment-pinned reconciliation run. Freeze analyzed-webhook ingress only at
the lower-release transition, after proving no result-producing work remains.
Prefer a compatible forward deployment; add no fallback or recovery guard.

## Verification

- Run the focused Hosted Execution schema suite and Web Retell result-lifecycle
  suite.
- Run Hosted Execution and Web typechecks.
- Inspect the diff, run privacy and `git diff --check`, then complete the
  required exact-head ReviewGPT and GitHub Actions gates.

Current evidence:

- 3 Hosted Execution mixed-version schema cases pass;
- 11 Web stored-recovery and Retell lifecycle cases pass, including durable
  policy recovery, legacy optional behavior, and producer absence;
- Hosted Execution and Web typechecks pass;
- preliminary specialists returned one accepted semantic-consumer finding and
  no patch artifact; and
- final ReviewGPT round 1 passed the original reader split; round 2 accepted
  the semantic correction and required the rollout-contract retrospective
  recorded above. A later PASS is still required;
- the rollout-contract remediation completed the diff-scoped Web verification:
  821 files / 10,951 tests passed, Web typecheck passed, ESLint completed with
  only pre-existing warnings, dev smoke passed, and the production Next build
  passed with its existing optional Privy peer warning; and
- the workspace-boundary diagnostic exposed this branch's schema fixture
  importing `zod` directly. The fixture now uses the declared
  `@murphai/contracts/zod-runtime` public entrypoint and its 3 cases pass. The
  standalone boundary guard no longer reports this PR and remains nonzero only
  for four pre-existing violations in unrelated CLI, device-sync, and hosted
  crypto tests.

## Deployment

Deploy this reader-only Web release first. Do not activate any producer that
writes `completionPolicy` until the production alias serves this release,
earlier Web route invocations have drained for the full configured function
lifetime, and no pre-reader deployment-pinned phone-call reconciliation run is
pending or running. PR #1351 is the later writer activation and becomes the
operational post-write floor. This release remains a compatible consumer but
cannot safely produce new transfer results after that activation. A zero
tracked-result-channel count cannot authorize an older strict reader or prove
producer safety.
