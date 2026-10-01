---
title: 'ReviewGPT accepted send can lose its recovery identity before the conversation URL stabilizes'
severity: 'minor'
---

## Expected Behavior

A waited review must preserve its exact managed target and accepted user-turn identity as soon as the send is committed, even while the conversation URL is still stabilizing. Recovery must remain bound to that accepted turn and attachment.

## Current Behavior

The pinned sender recognizes a committed user turn, then rejects a URL that is neither canonical nor the supported transient form before writing capture metadata. The conversation later becomes available and finishes, but the required original receipt is absent. Ordinary export can recover a substantive response and its preceding turn, while the exact-metadata recovery path remains unavailable. This blocks using the result as the repository's final review gate.

## Possible Solution

Preserve the exact target and committed-turn receipt before validating URL readiness, or wait for the canonical URL while retaining those bindings. Keep fail-closed attachment, response, and model checks; never resend an accepted request merely because its URL is delayed.

## Minimal Reproducible Example

Use the repository-pinned ReviewGPT command and a synthetic PR snapshot in a fresh managed Chat target. Delay the post-send URL transition while allowing the user turn to commit. Verify that the failure path retains a usable receipt bound to the original target and turn, and that later recovery validates the original attachment and completed response without resending.

## Context

A telemetry-only candidate passed focused proof, but final review could not be attested through the documented exact-metadata recovery. The relevant sender boundary is persistAcceptedSendIdentity in the pinned dependency. Preserve only synthetic fixtures in any regression; no conversation contents, machine paths, credentials, or production data belong in the report.
