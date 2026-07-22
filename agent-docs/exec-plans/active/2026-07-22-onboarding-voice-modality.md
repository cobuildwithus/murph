# Onboarding voice modality and song removal

## Outcome

Make the onboarding foundation voice invitation low-friction for every member,
offer voice-memo walkthrough help when known age is over 40, mirror a member's
voice choice for the later labs closer, and remove songs from onboarding while
keeping song generation available elsewhere.

## Scope

- Update the onboarding skill and durable product spec.
- Remove onboarding-specific song requirements from the system overlay,
  behavior-followthrough, music-generation guidance, and tool description.
- Preserve the mandatory text launch close.
- Keep the independently useful Telegram fallback that delivers accompanying
  text when transcriptless music preparation fails.
- Update focused prompt, skill, and channel regression tests plus the docs
  index summary.
- Add no persisted modality state, age segment owner, automation, or new
  delivery mechanism.

## Invariants

- Typing is always presented as equally valid when onboarding asks for a voice
  memo.
- Walkthrough help is offered only when visible or saved evidence shows age is
  over 40; unknown age does not block onboarding.
- The labs closer uses generated voice only after the member answered the
  foundation invitation with voice and has not since declined voice; otherwise
  it is text.
- Removing onboarding songs does not remove requested songs, group songs, or
  the general `generate_song` capability.
- The text close and text fallback remain deliverable when audio preparation
  fails.

## Verification

- Focused assistant skill, prompt, tool-description, and channel tests.
- Canonical `pnpm test:diff` for all touched owners.
- Direct stale-policy search and full diff review.
- Local product-experience review and preliminary ReviewGPT prompt/coverage
  lenses on the exact pushed PR head.
- Final ReviewGPT because the retained Telegram fallback touches external
  message delivery behavior.

