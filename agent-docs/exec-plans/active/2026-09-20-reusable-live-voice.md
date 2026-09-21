# Package reusable live voice components and prepare PR

## Outcome

Publish a reviewable PR with green required checks for reusable GPT-Live voice
components. Keep the demonstrated Willow default, cloud motion, user shrink,
assistant pulse, and start/pause/resume/end lifecycle.

## Product UX

- Outcome: pages can embed the widget with a session endpoint, choose size/color,
  render the decorative orb independently, or compose their own controls.
- Entry: one public component import; documented examples and typed props.
- Reaches: browser integrators and local preview users; microphone permission,
  paused/error recovery, mobile, reduced motion, and graphics fallback.
- Exclusion: this does not launch paid voice calls or Murph record access for
  members. The local demo endpoint remains restricted; public pages must use
  an authenticated, usage-gated server session endpoint.
- Proof: actual exported components in responsive studies, custom composition,
  call lifecycle tests, live synthetic-audio replay, and typecheck/lint/CI.

## Implementation

Expose LiveVoiceButton, LiveVoiceControl, LiveVoicePicker, VoiceOrb, and
useLiveVoice through a single typed entrypoint. Keep session ownership in the
existing class. Make the raw orb self-contained and support named palettes and
size. Explicitly require an endpoint for connected use. Add embedding examples
and composed design proof; preserve unrelated merged main changes.

## Completion

Implementation and parent candidate review complete. Focused voice suite: 32
passed; reusable component browser proof: three viewport journeys passed;
existing orb playground: six passed. Web typecheck, changed-file lint, and
complexity guard passed. Actual synthetic-audio GPT-Live replay verified Willow,
user shrink, assistant pulse, pause/resume/end, and reduced motion. Compact and
standalone palette screenshots inspected. Single-file lifecycle ownership is
preserved; no dependencies were added.

PR #3619 is open. ReviewGPT round 1 passed on the initial candidate with no
qualifying findings. CI identified an unregistered raw OpenAI request in the
local prototype. Replaced it with the installed SDK's supported request API
(the SDK has no generated Live resource), explicitly disabled retries and logs,
and retained the fixed provider origin and 20-second timeout. The provider
boundary guard, 33 focused tests, typecheck/lint/complexity, and actual voice
replay passed. This correction requires updated-head review and CI.

Pending final ReviewGPT, exact-head CI, and protected preview readback. No public changelog: integration components and
local-only demo are not a launched member feature. No production deployment.
