# Integrate the shared voice orb with authenticated native calls

Status: active
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
- Blacksmith is rebuilding the unchanged final native patch for interactive
  testing. Final pushed-head ReviewGPT and CI remain pending.
- Close #3619 after this work is verified and published in #3612, as requested.
