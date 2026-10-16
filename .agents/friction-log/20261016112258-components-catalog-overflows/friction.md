---
title: 'Components catalog overflows the phone viewport outside scoped design proof'
severity: 'minor'
issue: 'cobuildwithus/murph#4157'
---

## Expected Behavior

The repository-owned components catalog should fit a 390px viewport so page-level overflow checks can validate a changed component without unrelated examples expanding the document.

## Current Behavior

The components catalog has a 628px document width at a 390px viewport. The hosted plan-change section itself fits between x=24 and x=366 with matching 342px client and scroll widths. A whole-page overflow assertion fails despite the changed section fitting correctly. The desktop document and section fit their viewport.

## Minimal Reproducible Example

Run the hosted Web Playwright smoke environment, block non-loopback requests, set a 390x1000 viewport, open /design?tab=components#hosted-plan-change, and wait for fonts plus two animation frames. Compare document.documentElement.scrollWidth with window.innerWidth, then inspect the hosted-plan-change section bounds and scrollWidth. The page exceeds the viewport while that section fits.

## Context

Responsive proof for a localized billing dialog needed section-scoped overflow checks and component-only screenshots. Find the overflowing catalog examples and contain them within their intended responsive surface; do not relax the changed component's checks or hide overflow globally.
