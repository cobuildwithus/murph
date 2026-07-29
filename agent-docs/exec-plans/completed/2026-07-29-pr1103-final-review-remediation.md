# PR 1103 final review remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

Make the Telegram-to-iMessage contact handoff reachable, rollback-safe, and
usable by the same member identity.

## Success criteria

- The runtime-to-Web control policy admits only the exact signed POST route.
- Murph's line is read only through the current-input tool, never persisted in
  Telegram wake or assistant-input metadata.
- Web returns or assigns a line only when the member already has a verified
  phone or email that an inbound iMessage can resolve to the same member.
- A member without that identity receives a clear settings recovery step and
  consumes no line.
- Existing-number reuse and concurrent first assignment still consume at most
  one line.
- Focused proof, product review, canonical verification, CI, and the next
  ReviewGPT round pass.

## Tasks

1. [x] Add the missing Web-control allowlist entry and real transport proof.
2. [x] Delete the persisted Telegram wake contact shortcut.
3. [x] Gate read-or-assign on existing verified iMessage sender identity.
4. [x] Update durable docs and rerun product review.
5. [x] Run canonical verification and package the remediation candidate for
   the post-plan PR gates.

## Verification

- Focused Assistant Engine, Web, hosted-execution, and Cloudflare tests.
- Product-experience review of the identity-required recovery path:
  `PURPOSE_VERDICT: PASS`, no findings.
- `pnpm test:diff` for every remediation path: passed after building the
  harness-required `packages/assistant-runtime/dist` artifact.
- `pnpm verify:acceptance`: passed, including package coverage, Web verification
  and production build, Cloudflare Node and Workers tests, and fixture coverage.

## Post-plan PR gates

- Push the exact remediation commit and update the PR evidence.
- Complete ReviewGPT correction round 2 against the immutable first-reviewed
  baseline.
- Clear exact-head GitHub CI and confirm mergeability.
Completed: 2026-07-29
