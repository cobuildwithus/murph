---
title: 'Review archive fixtures inherit operator Git hooks'
severity: 'minor'
---

## Expected Behavior

Synthetic Git repositories in the native review archive tests use isolated hook configuration.

## Current Behavior

A global core.hooksPath can run operator hooks during fixture setup. A privacy hook rejects the deliberately synthetic fixture author before archive behavior is exercised.

## Possible Solution

Set the temporary repository's core.hooksPath to its own empty .git/hooks directory. This task applies that correction and verifies all ten native context tests.

## Minimal Reproducible Example

Configure an operator Git hook that rejects a fixture-only email, then run scripts/review-gpt-native-context.test.ts. Setup commits fail before packaging unless the temporary repository isolates its hooks.

## Context

Encountered while proving durable review-round metadata. Real task commits retain all repository hooks.
