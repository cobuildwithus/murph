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
  reader is live and prior Web invocations have drained; and
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

## Implementation

1. Extend only the shared strict result reader with the optional bounded policy.
2. Add mixed-version schema proof: legacy plaintext remains readable by the new
   reader, the new policy is bounded, and the previous strict reader rejects it.
3. Pin the current transfer producer proof to legacy absence.
4. Document the reader-first deployment, old-invocation drain, and rollback
   floor that PR #1351 must reference before activating the writer.

## Invariants

- Encrypted `HostedPhoneCall` result storage remains the sole result owner.
- This prerequisite changes accepted input only and writes no new value.
- Existing transfer follow-up behavior remains unchanged until the later
  writer activation.
- No database column, migration, queue, scheduler, flag, callback, or alternate
  result representation is introduced.

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
- final ReviewGPT round 1 passed the original reader split, but a new round is
  required because the accepted specialist remediation changes behavior.

## Deployment

Deploy this reader-only Web release first. Do not activate any producer that
writes `completionPolicy` until the production alias serves this release and
all earlier Web invocations have drained for the platform's full configured
function lifetime. PR #1351 is the later writer activation. After its first
policy-bearing result, this reader release is the permanent Web rollback floor;
a zero tracked-result-channel count cannot authorize an older strict reader.
