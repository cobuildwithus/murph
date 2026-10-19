---
title: 'Docs drift requires architecture documentation for a one-link Records correction'
severity: 'minor'
---

## Expected Behavior

A localized navigation correction with focused real-component and browser proof should follow the small-patch workflow without implying an architecture contract changed.

## Current Behavior

The docs drift guard classifies a single href correction in the Records page as architecture-sensitive and requires matching documentation or an active plan.

## Minimal Reproducible Example

Change the connection-management privacy link in the Records page to the existing legal privacy route, add a focused navigation regression, then run pnpm docs:drift. The guard rejects the code-only change even though no state owner, provider boundary, consent rule, or data flow changed.

## Context

A proportional execution plan satisfies the existing gate. Consider narrowing the classification or documenting the plan requirement in the small-patch routing guidance.
