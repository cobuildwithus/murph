---
title: 'Linq recovery count assertions omit request attribution diagnostics'
severity: 'minor'
---

## Expected Behavior

A failing no-replay assertion should retain its strict expected count and show enough privacy-safe fixture evidence to distinguish replayed target work from other requests in the shared scenario.

## Current Behavior

The first-contact recovery tests count every Responses API request in the shared scenario. A plain numeric assertion failure skips the existing scenario failure diagnostics, so it does not reveal request kinds, scoped fixture matches, or whether the target fixture was requested again.

## Minimal Reproducible Example

In the pre-accept rich-link recovery test, compare a synthetic baseline plus one expected request with a capture containing that target request and unrelated scenario requests. The assertion fails with two numbers only. The same result is possible if the target was replayed; the diagnostic cannot distinguish them.

## Possible Solution

Preserve the strict assertion and add bounded counts and the existing sanitized scenario diagnostics only when it fails. Do not relax the gate or assume the additional requests are benign.

## Context

This prevents reliable investigation of a production-admission test failure. It is test-observability friction, not a claimed production provider defect.
