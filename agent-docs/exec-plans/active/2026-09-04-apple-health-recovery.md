# Apple Health receipt recovery

## Outcome and scope

Extend the existing private source-recovery check-in to Apple Health after
72 hours without a receipt. Preserve one notice per silence episode, current
source revalidation, active private iMessage routing, and member opt-out or
5–30 day timing preferences. Do not infer app presence, missing permissions,
disconnection, or a device fault from silence. No new scheduler, schema, or
provider request is needed. The existing response parser must accept the new
three-day default, so upgraded runtime consumers must precede Web rollout.

## Product UX plan — Product change

- Existing member with previously received Apple Health data: after three days
  of silence, receive one private check-in suggesting Murph's Check for new
  data action. Explain the observation without blaming app closure.
- Member who expects quiet data: an explicit private reply can stop these
  Apple Health check-ins or extend their threshold through the existing tool.
- Fresh, never-delivered, disconnected, inactive, opted-out, or group-only
  member: remain silent through existing admission boundaries.
- Member whose data resumes before dispatch: cancel the superseded episode.
- Garmin member: keep the existing policy, wording, and preference behavior.

## Architecture and load

Recovery policy is independent of push-primary polling classification. Reuse
source timestamps, existing bounded runtime apply candidates, preference rows,
mailbox dedupe, and dispatch revalidation. Existing bounded, serial candidate
transactions and private routing remain unchanged; no fleet scan or new timer.
The independent iOS receipt-refresh patch uses the existing status contract.

## Steps

- [x] Generalize recovery eligibility without changing provider polling.
- [x] Add Apple Health wording and expose existing preference controls.
- [x] Prove threshold, private routing, dedupe, recovery, and preference paths.
- [x] Run focused tests, affected typechecks/builds, and real-Codex opt-out proof.
- [ ] Review Product UX, add changelog, commit, and open PR.
- [ ] Run exact-head ReviewGPT concurrently with required CI and finish gates.

## Validation and status

Source policy and recovery transport reuse are implemented. Deterministic proof:
1,304 device-sync tests passed; the later default-parser red/green regression
and source-policy suite passed 112 tests. Web reminder/preference/copy suites
passed 40 tests; dispatch plus materialization passed 75. Assistant tool tests
passed 50. Affected Web, device-sync, and assistant typechecks and device-sync
build passed. Complexity debt did not increase.

The focused real-Codex Apple Health opt-out journey used gpt-5.6-terra and local
subscription auth. Earlier samples exposed duplicate calls and uncertain
acknowledgements; tool guidance now explicitly describes saved confirmation
and the unchanged sync connection. The assertion rejects uncertainty, and the
latest run made one off call and clearly confirmed success. Parent reply review:
Ready for the tested run, with ordinary stochastic limitations. Default profiles
that failed before any provider action used the documented alternate-home retry;
existing Frog issue #2695 covers that startup friction.

Initial-input proof used the pinned App Server and a hermetic Responses stub,
production prompt/tool builders, identical direct/group fixtures, normalized
message IDs and temporary paths, and o200k_harmony. The only remaining provider
input difference is the device tool description. Direct: 29,918 to 29,956 tokens
(+38, +0.127%), 137,897 to 138,084 bytes (+187). Group: 26,738 tokens / 123,117
bytes at both heads. Model/transport/cache metadata is excluded identically.

Product walkthrough: eligible private recovery is actionable and non-blaming;
opt-out, extended delay, stale episode cancellation, and group silence use the
existing boundaries. Garmin remains five days and push-primary classification
is unchanged. No production mutation or direct member message was performed.

Deployment: upgrade Cloudflare runtime consumers and converge warm containers
before Web emits the Apple Health three-day default. New consumers accept old
responses; old consumers reject the new default (proven red/green). iOS PR #139
uses an unchanged status contract and can ship independently. Review and CI are
pending; this is not a production deployment claim.
