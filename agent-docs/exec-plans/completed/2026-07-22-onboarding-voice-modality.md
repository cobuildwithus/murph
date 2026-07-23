# Onboarding voice modality and song removal

## Outcome

Make the onboarding foundation voice invitation low-friction for every member,
offer voice-memo walkthrough help when known age is over 40, mirror a member's
voice choice for the later labs closer, and remove songs from onboarding while
keeping song generation available elsewhere.

## Scope

- Update the onboarding skill and durable product spec.
- Coordinate with the overlapping song-removal lane, then rebase onto its
  `main` commit so the mandatory text close, explicit-request song path,
  changelog cleanup, and Telegram fallback remain the shared baseline.
- Update focused prompt and skill regression tests plus the docs index summary.
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

- Focused assistant skill and prompt tests.
- Canonical `pnpm test:diff` for all touched owners.
- Direct stale-policy search and full diff review.
- Local product-experience review and preliminary ReviewGPT prompt/coverage
  lenses on the exact pushed PR head.

## Completion evidence

- The overlapping lane landed the song removal, explicit-request exception,
  changelog cleanup, and Telegram fallback on `main`; this branch rebased onto
  that result and retained only the voice-modality delta.
- Product-experience review returned zero findings.
- Preliminary ReviewGPT accepted two findings: avoid an unqualified song ban
  in the always-loaded overlay, and strengthen the modality contract's negative
  guards. The rebased `main` wording resolved the first; focused assertions for
  guessed age, voice decline, tool availability, duplicate text, and fallback
  resolved the second.
- Focused prompt/skill coverage passed 31 tests.
- Canonical `pnpm test:diff` passed repository guards, affected typechecks,
  assistant-engine (2,601 tests), assistant CLI (128), assistant runtime (1,791),
  and assistantd (40). The remaining CLI workspace lane self-deadlocked when a
  nested test-runtime builder waited on its parent verifier's artifact lock; the
  owned process tree was stopped after the lock owner and wait cycle were
  verified.
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
