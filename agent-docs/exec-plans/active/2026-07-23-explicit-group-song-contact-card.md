# Explicit group song and contact card

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Let Murph complete an explicit group request for a song and contact card in the same turn.

## Success criteria

- The group-chat skill no longer treats a song and contact card as mutually exclusive.
- The one-reply default still prevents unsolicited double-texting without blocking requested tool-owned effects.
- Murph is told to describe real tool failures accurately instead of inventing provider limitations.
- Focused tests, canonical diff verification, required product review, and the prompt/coverage specialist pass succeed.

## Scope

- In scope: group-chat prompt guidance and its deterministic prompt-contract test.
- Out of scope: Linq, ElevenLabs, contact-card delivery code, media schemas, retries, and provider routing.

## Constraints

- Keep the change prompt-only and delete the overbroad rule instead of adding runtime machinery.
- Preserve the existing restraint on unsolicited intro songs and extra authored bubbles.

## Tasks

1. Simplify the group-chat message-shape and intro-song guidance.
2. Add a focused regression for explicit compound requests and truthful failure language.
3. Run focused and canonical verification plus required completion reviews.
4. Commit, open the PR, verify CI and mergeability, then close this plan for handoff.

## Verification

- Focused prompt-contract test: passed (4 tests).
- Canonical `pnpm test:diff` proved the touched assistant-engine owner, affected
  typechecks, and assistant runtime suites. Its unrelated CLI reverse-dependent
  leg was stopped after existing CLI tests timed out or failed in untouched
  files, so the overall command did not complete green.
- Product-experience review: no findings. It confirmed the prompt change is the
  smallest complete behavior correction; direct live proof remains limited to
  the already observed independent contact-card and song successes.
- Preliminary specialist review: two medium findings, both accepted. The prompt
  now prioritizes pending answers and first-reply card work over unsolicited
  songs, and the real Codex app-server/scripted-provider lane proves compound
  success plus truthful owner-failure propagation. No patch artifact returned.
- Remediation proof: focused prompt and real app-server tests passed (19 tests);
  assistant-engine typecheck passed.
- Final canonical verification, parent review, CI, and mergeability: pending.
