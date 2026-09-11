# Native Environment interview presentation

Status: completed

## Outcome

Members answer the Environment audit through native iOS questions and controls.
SwiftUI owns every visible element and interaction. Keep canonical interview
processing, question scripts, language choices, validated saves and final-answer
confirmation in the existing engine. WebKit remains only a hidden WebRTC engine;
no website form, browser chrome or developer badge is presented or accessible.

## Design and boundaries

One native navigation bar, topic title and compact question rows. A persistent
native footer owns Start talking, Finish, retry and topic navigation. Native
language selection reuses canonical choices. Show saved/pending answers and
honest completion. First use starts directly at the first topic, without an
extra readiness page. Preserve Dynamic Type, theme and Reduced Motion.

A closed command protocol drives the existing engine and a bounded state
snapshot drives native presentation. Native credentials stay outside JavaScript.
Preserve origin/main-frame admission, cancellation, session identity pinning,
background microphone teardown and accepted-answer report refresh. Remove the
obsolete embedded website presentation instead of keeping two native layouts.

## Proof

Test native commands against the real interview state machine, save/finish
behavior, native snapshot decoding and SwiftUI controls. Render real simulator
idle, permission, recovery, completion, dark and large-text states as applicable.
Run native compile/tests/format and focused web tests/typecheck/lint/complexity.
Use a fresh local independent review before scoped commits. Physical-device
speech and deployed convergence remain release checks, not simulated claims.

## Implementation and review

SwiftUI now opens directly on canonical questions and owns every visible
control. The shared engine renders no Web form. State includes confirmed and
pending answers, a bounded transcript tail, microphone attention, language and
completion; native command acknowledgment is tied to the dispatched command ID.
The old embedded presentation and unused native Close command were removed.

Independent local review found two issues: fully completed audits use a
catalog-sized update topic, and native listening initially omitted the existing
microphone warning. Both are fixed. Free-form updates retain their canonical
prompt without a catalog checklist; native listening receives microphone
attention. The reviewer verified corrections and reported no remaining
confirmed findings. Failure removes the hidden engine before retry.

Web: 27 focused tests, prepared typecheck, ESLint, complexity diff against HEAD
and documentation drift checks pass. Native: XcodeGen and Swift compilation
pass; focused session/API/origin/presentation tests pass. Simulator UI proof is
recorded below after final replay. The broad unsigned simulator test command
also encountered four unrelated Keychain entitlement failures (-34018) in meal
capture tests; it is not reported as a passing full suite. A simulator
accessibility-service failure required restarting only the owned test device.

Changelog decision follows the existing unreleased feature lane: no public
archive entry before a release PR. This task creates no PR, push or deployment.
The existing realtime prompts, parser and saving APIs are unchanged.

## Final local proof

Product UX: Ready for local review. Across focused runs, 331 native unit tests
and all 10 Environment UI journeys pass. The final replay passes native
questions and controls, actual simulator microphone permission through a forced
connection retry, and largest Dynamic Type navigation. XCTest enumerates
hidden WebKit nodes, so the assertion checks that no WebView is hittable rather
than requiring no engine in the view hierarchy. Native and WebKit accessibility
hiding are configured explicitly. The parent inspected idle, retry and large
text screenshots and opened the updated native screen in Preview.

Release: Hold for signed-in physical-device speech, final-answer completion,
background capture shutdown and hosted saved-answer-to-grade convergence.
Synthetic connection failure does not claim provider or member-write proof.
Ship the headless Web engine before the corresponding native version; both
remain local commits in the existing feature lane.
Updated: 2026-09-06
Completed: 2026-09-06
