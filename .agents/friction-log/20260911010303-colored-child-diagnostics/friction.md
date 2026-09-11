---
title: 'Colored child diagnostics hide hosted-local port collisions'
severity: 'minor'
---

## Expected Behavior

Hosted-local startup should classify a child process address-in-use error regardless of terminal styling, preserve the stable retry marker, and use its existing bounded retry with fresh port reservations.

## Current Behavior

The classifier applies a leading word-boundary regular expression directly to buffered child output. A bold ANSI sequence immediately before Address leaves an ASCII m adjacent to that word, so the expression misses the error. When later output pushes the original message beyond the short diagnostic tail, the outer startup owner cannot recover its classification.

## Minimal Reproducible Example

Pass a child stderr buffer containing the JavaScript string "\u001b[1mAddress already in use (0.0.0.0:43001).\u001b[0m\n" followed by 4,000 filler characters through the existing child-exit readiness path. The plain-text equivalent receives the stable address-in-use marker; the styled equivalent does not.

## Possible Solution

Use Node's stripVTControlCharacters only before the existing child-output collision expressions. Preserve diagnostic redaction, retention, owned cleanup, and the current maximum of three startup attempts.

## Context

This is reproducible repository harness friction that can stop hosted E2E before any business assertion executes. The defect concerns error classification; it does not identify the original competing port owner.
