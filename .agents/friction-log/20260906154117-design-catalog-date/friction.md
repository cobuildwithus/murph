---
title: 'Design catalog date hydration disrupts browser proofs in UTC+14'
severity: 'minor'
issue: 'cobuildwithus/murph#3012'
---

## Expected Behavior

The synthetic components catalog should hydrate consistently when the browser time zone differs from the development server, so focused component interaction proofs can start reliably.

## Current Behavior

Opening the components catalog in Pacific/Kiritimati against a UTC server produces a date hydration mismatch in the unrelated group sponsorship study. React replaces the catalog tree while the Journal proof is activating its synthetic region, detaching the element before interaction.

## Possible Solution

Give synthetic catalog date displays a shared explicit time zone or isolate component studies so an unrelated hydration mismatch cannot replace the target study. The Journal proof currently changes the browser zone after catalog hydration to exercise chart labels independently.

## Minimal Reproducible Example

Start the Web smoke server with UTC. Open `/design?tab=components#journal-study` with a Chromium context configured with `timezoneId: "Pacific/Kiritimati"`. Observe the synthetic group sponsorship date rendering on different calendar days between server and browser and the resulting hydration replacement.

## Context

This required a browser-proof workaround during Journal date-label verification. It concerns synthetic catalog rendering; no production member data was used.
