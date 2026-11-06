# Integrate the shared voice orb with authenticated native calls

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Goal and invariant

Use the shared cloud orb from PR #3619 in the authenticated native voice page.
Preserve the native call owner, durable input admission, billing and confirmed
shutdown while showing local speech amplitude through the requested visual.

## Scope and ownership

Reuse PR #3619 at `2be18817364de456a634eab8e4fa6dbe2fc43c5e` for the renderer,
audio meter and speech-driven appearance. The existing browser call owner owns
meter allocation and disposal. Amplitude is transient presentation data and is
never recorded or sent to a server. The design playground reuses the renderer.

Keep the existing authenticated `/voice` route. Do not import the separate demo
session API or add another session owner. Voice selection, provider contracts,
billing changes, merging and deployment are outside this follow-up. The user
waived public screenshot publication; that waiver remains in force.

## Product UX

- Outcome: members talk through the requested orb while retaining all existing
  admission, media cleanup and call-end feedback.
- Entry: `/voice`; signed-out people first use the existing sign-in dialog.
- Journeys: idle/start, connecting/cancel, input/output speech, microphone mute,
  blocked playback, end, denied permission, lost connection, reduced motion,
  WebGL fallback and phone/desktop layouts.
- Meaning: the orb mutes the microphone. Murph playback and duration billing can
  continue until the member uses the separate end action.
- Done when: these paths work through the actual production controls, the
  changed lifecycle passes focused proof, and ReviewGPT and required CI pass.

## Risks and mitigation

Optional visual feedback must not interfere with a call. Graphics and audio
meter failure remain nonfatal; tests cover cancellation, late permission and
shutdown cleanup. Derive visuals from the existing state instead of adding
provider authority or another connection lifecycle. No deployment skew is
introduced: the call-control protocol and native patch are unchanged.

## Tasks

1. Reuse the renderer and design playground; remove the old renderer duplicate.
2. Attach metering to the native browser lifecycle and compose the orb controls.
3. Prove responsive presentation, accessibility, audio feedback and lifecycle.
4. Push the verified candidate and start ReviewGPT concurrently with CI.
5. Prepare the native Linux test runtime and an honest interactive handoff.

## Verification

- Focused browser media and component tests; Web typecheck and changed-file lint.
- Playwright voice and orb journeys at phone/desktop sizes, including actual
  production controls with synthetic props and graphics/permission recovery.
- `pnpm complexity:diff`, exact-head CI and final ReviewGPT after candidate push.
- Native hosted synthetic voice proof and interactive setup on Blacksmith.

## Progress

- Shared renderer and audio meter imported from the identified #3619 head;
  duplicate playground renderer removed. Only the native authenticated route
  and browser call owner remain.
- Seventeen focused media/component tests pass, as do Web typecheck, changed-file
  ESLint and the complexity guard (orb control maximum 17, meter maximum 6).
- Eight Chromium journeys pass: 390/1440 native state studies and the shared
  playground's 320/390/1280 layouts, keyboard/touch, reduced motion, static PNG
  fallback and context restoration. Inspected synthetic phone/desktop captures
  show readable controls and captions without overflow.
- Product UX: Ready for this presentation change; optional metering failure,
  canceled startup and immediate shutdown cleanup are covered. The existing
  `talk-with-murph` changelog item groups this same unshipped member outcome.
- Blacksmith rebuilt the unchanged final native patch in 38m59s. The resulting
  hosted runner bundle passes every parity probe and its size guard.
- The complete native hosted voice proof passes with real synthetic microphone
  audio, a read-only vault tool, audible selected output, both input/output orb
  activity, immediate microphone release, provider-confirmed shutdown and three
  trusted usage records. Connection took 44.6s; speech-to-answer took 28.9s in
  this development fixture, not a production latency or reliability guarantee.
- The local launcher smoke passes: an isolated synthetic member opens the real
  authenticated Voice page through a localhost SSH tunnel, then browser and
  stack cleanup complete. The user received the one-command launcher because
  terminal automation is unavailable. Temporary scaffolding stays ignored; no
  test session, provider credential or machine path is committed.
- Exact-head CI remains a PR completion gate: all ordinary checks pass so far,
  while native-image and runner-bundle jobs are still running. The public
  preview URL check remains explicitly waived by the user.
- #3619 is closed after verified visual work was pushed in #3612 at
  `7fc764909caed1e7f3490e0039b6aed0654eb86d`; its body links the replacement.
- Full-snapshot GPT-6 Pro round 3 passed with zero findings at that head.
  Response hash `904ba60db4bde58a957cbf339fec3480ecf5ed07047d36b2db66bd3431264847`,
  exact committed-turn identity, model and 725-second capture verified. The
  owned target is closed. Native patch is unchanged from the reviewed round 2.
- The live proof script now uses the orb controls' accessible microphone labels
  and requires both user and assistant activity through the real local meter.
  This is isolated proof maintenance and does not change production behavior.
  Web typecheck and its changed-file lint pass.

## Implementation closeout

Implementation, direct proof, final external review and the local test handoff
are complete. The final commit adds only isolated browser-proof assertions and
this evidence; production behavior is unchanged from the reviewed head. Final
exact-head CI remains the PR completion gate and is tracked in the PR body. No
merge, deployment or public preview publication has occurred.
Completed: 2026-09-21
