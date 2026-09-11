# iOS Environment voice audit and first-use experience

Status: completed

## Outcome

Members can talk to the iOS app to fill in or update their Environment audit,
and open their resulting grade from Home. The first-use view explains the
outcome and starts the interview instead of showing an empty grade table.

## Design and ownership

Reuse the canonical web interview, question script, realtime connection API,
answer parser, mailbox writes, and report refresh. Present the same interview
in an isolated, ephemeral first-party WebKit view. Native holds credentials;
a closed request bridge never exposes credentials or arbitrary network access.
Reuse the website's Habitat object illustrations for native report identity.
Keep the removed disclaimer and coverage counts out of the summary.

## Boundaries

Bearer requests pin the expected signed-in identity. Cookie requests keep
origin protection. Access and consent remain authoritative. Bound payloads,
reject redirects and foreign/subframe bridge calls, and stop capture when
leaving the foreground, dismissing, or changing member/consent. No new SDK,
background microphone, raw audio persistence, or second scoring owner.

## Verification

Prove bearer/cookie isolation, identity pinning, bridge operations and limits,
canonical script/empty-state selection, save and refresh behavior, teardown,
and existing web voice behavior. Compile/typecheck both consumers; inspect
fresh simulator empty/report/voice/error/dark/large-text screenshots. Use an
independent local deep review before scoped commits. Real hosted microphone
and runtime-save evidence remains distinct from mocked local proof.

## Result and proof

Implemented the illustrated native welcome and report, with Home entry and
in-app voice input through the existing website interview. Questions remain
on screen, matching Web; this change does not add synthesized spoken questions.
Native retains credentials and pins the active identity. No new provider,
question engine, grade store, or raw audio persistence was introduced.

Web: 56 focused tests pass across realtime admission, script/projection, native
bridge, capture and refresh. After the final native permission-copy adjustment,
the 20 capture tests pass again. `pnpm --dir apps/web typecheck:prepared`, focused
ESLint and `pnpm complexity:diff` pass. The capture render header is now a small
component; its parent complexity decreases from 93 to 92. Existing parser and
replica-loader hotspots retain their established behavior.

Native: 328 API/session unit tests passed in the broad focused run. The four
new voice session tests passed again after refreshing the post-processing
snapshot baseline. Nine Environment UI journeys pass across focused runs:
home/details, empty, partial, stale, preparing, unavailable, largest Dynamic
Type, in-app bootstrap/confirmed close, and microphone admission with a
recoverable connection failure. `xcodegen generate` and Swift compilation pass;
`swiftformat --lint . --exclude build` passes. The exclusion omits downloaded
vendor code under the ignored DerivedData directory.

Inspected real simulator screenshots in light and dark appearances, including
first use, report rows, largest text and the actual embedded WebKit interview.
Opened the new screens in Preview. Corrected an inherited purifier background,
a tab bar covering the main action, large-text wrapping, and an accessibility
identifier collision. One intermediate Xcode run executed stale UI test code;
fresh compilation and targeted reruns verified the current assertions.

Independent local deep review found default-port microphone admission, inactive
permission prompt dismissal and unconfirmed native Done exit issues. All were
corrected and rechecked. Native Close now confirms leaving; canonical Web Finish
retains final-answer confirmation. The actual simulator microphone permission
flow and forced connection-retry path pass. Provider connection is deliberately
unavailable in the synthetic native fixture; no real interview or member write
was claimed from this test.

Product UX: Ready for local review. Release: Hold for a signed-in physical-device
check of spoken answers, final utterance, background capture shutdown, and
hosted mailbox-to-report convergence. Deploy the additive Web page/routes before
iOS. This local task creates no PR, push, deployment or public availability claim.
Changelog publication belongs to the eventual release PR; this unmerged local
build is excluded from the shipped archive. No member prompt or runtime tool
behavior changed, so the existing deterministic interview tests cover the reused
engine rather than a new real-Codex interpretation journey.
Updated: 2026-09-06
Completed: 2026-09-06
