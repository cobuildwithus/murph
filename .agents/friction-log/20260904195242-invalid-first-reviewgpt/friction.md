---
title: 'Invalid first ReviewGPT attempt prevents review after an authorized head change'
severity: 'minor'
---

## Expected Behavior

An authorized new candidate can receive its first valid full review after an
earlier model/capture-invalid attempt. The supported procedure should preserve
diagnostic history without miscounting substantive rounds or silently replacing
an established review baseline.

## Current Behavior

The review-loop instructions make the first recorded head immutable and state
that invalid attempts do not advance the round counter. The packager also
requires the round-one recorded head to equal the current PR head. Together,
these rules leave no supported next invocation after an invalid initial attempt
and an authorized candidate change.

## Minimal Reproducible Example

1. Record head A for an initial PR review; the response fails model or capture validation.
2. Make and push an authorized functional change, producing descendant head B.
3. Preserve A in the PR body and run `REVIEW_GPT_ROUND_NUMBER=1 pnpm --silent review:gpt pr-review --dry-run --model pro`.
4. Packaging rejects the invocation because the round-one PR-body head must equal the current head.

Changing the recorded head conflicts with the immutable-baseline rule; using
round two conflicts with invalid-attempt counting. Clarify the supported
transition before adding more review machinery.

## Context

The candidate can pass local correctness and performance proof yet remain
unable to enter the required final review without an additional policy decision.
