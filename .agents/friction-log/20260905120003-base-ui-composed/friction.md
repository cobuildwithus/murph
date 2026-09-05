---
title: 'Base UI composed DOM tests need browser globals before module import'
severity: 'minor'
---

## Expected Behavior

A composed test using renderClientComponent can open the real Base UI selector
and select an option after rendering the production component.

## Current Behavior

Statically importing the production component before renderClientComponent
installs document makes Base UI choose its no-op useIsoLayoutEffect for the
whole module lifetime. The selector renders, but clicking it does not expose
options. Basic initial-markup assertions still pass.

## Possible Solution

Document the existing mount-before-dynamic-import pattern beside the shared
DOM harness for components that select browser behavior at module evaluation.

## Minimal Reproducible Example

Statically import LabsPage, then render its resolved element through
renderClientComponent in a Node Vitest file and click Catalog type. No options
appear. Create the harness first, dynamically import the page, and rerender
its resolved element to exercise the real control. Linkedom also needs the
existing inline-style getComputedStyle shim for popup positioning.

## Context

Observed while replacing whole-client and UI-control mocks with composed Labs
page journeys. The task reuses the existing harness and modal style shim.
