---
title: 'Browser session key tamper test can preserve ciphertext'
severity: 'minor'
---

## Expected Behavior

The malformed-envelope regression must always change the encrypted bytes before asserting authentication failure.

## Current Behavior

The test replaces the final two base64 characters with `AA`. Random ciphertext can already end with `AA`, leaving the payload unchanged and failing the assertion that decryption rejects.

## Possible Solution

Decode the synthetic ciphertext and flip one bit before re-encoding it.

## Minimal Reproducible Example

Generate synthetic browser-session envelopes until one ciphertext ends with `AA`. Replacing that suffix with `AA` preserves the original string and decryption succeeds. Flipping the first decoded byte makes decryption reject.

## Context

This pre-existing intermittent test failure blocked a required release coverage shard. The correction changes only the test payload construction; production cryptography stays unchanged.
