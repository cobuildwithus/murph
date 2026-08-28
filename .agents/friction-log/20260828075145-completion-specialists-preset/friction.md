---
title: 'Completion specialists preset hardcodes synthetic PR identity'
severity: 'major'
---

## Expected Behavior

The preliminary `completion-specialists` ReviewGPT preset should name the
actual pull request number and exact pushed head supplied by its successful
preflight, so the reviewer can validate the attached packet against that
invocation.

## Current Behavior

The preset literally requires the final response to begin with synthetic
`PR #123 @ abc1234`. A real PR packet can correctly contain its actual number
and head while the model must treat it as inconsistent with the synthetic
invocation and return `SPECIALIST_OUTCOME: INVALID`.

## Possible Solution

Render the checked PR number and exact head into the preset, or remove the
synthetic identity from the required output and make the packet's review-phase
metadata the single exact-head source.

## Minimal Reproducible Example

1. Run `pnpm review:gpt completion-specialists --wait` from an open real PR.
2. Confirm preflight reports the real PR number and exact pushed head.
3. Observe that the staged prompt still requires
   `Checked preliminary specialists: PR #123 @ abc1234`.
4. Observe a correct reviewer reject the real packet as an identity mismatch.

## Context

This invalidated the required preliminary review for a small prompt-primary PR
after the exact packet had otherwise passed preflight and remained internally
consistent.
