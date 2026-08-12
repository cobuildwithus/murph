---
title: 'Design catalog OTP study adds a hydration warning overlay to unrelated frontend proof'
severity: 'minor'
---

## Expected Behavior

Opening the Sections tab in local development should render synthetic catalog studies without a Next.js issue overlay, so a section can be captured directly for frontend design proof.

## Current Behavior

The synthetic homepage authentication warm-runtime study renders an OTP input whose server and client inline style attributes differ. React reports a hydration mismatch and Next.js adds a one-issue overlay, even when the section under review is unrelated.

## Possible Solution

Make the OTP study's server and client style serialization deterministic, or defer that synthetic input until after hydration without changing the production component contract.

## Minimal Reproducible Example

1. Start the hosted Web app in local development.
2. Open `/design?tab=sections` at a mobile viewport.
3. Wait for hydration.
4. Observe the Next.js issue overlay reporting an inline-style mismatch in the synthetic OTP input.

## Context

The overlay contaminates otherwise valid desktop and mobile catalog screenshots and forces proof tooling to remove unrelated development chrome before capture.
