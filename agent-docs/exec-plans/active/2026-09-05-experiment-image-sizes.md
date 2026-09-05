# Match experiment image downloads to mobile cards

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal and Product UX

- Outcome: Download images sized for experiment cards on phones.
- Reaches: Public experiment browsing and existing card consumers, phone and desktop.
- Proof: Actual browser image selection and rendered card dimensions, existing card tests, Web typecheck, exact-head CI and ReviewGPT.

## Architecture and scope

Keep Next Image, the existing image assets, quality, lazy loading and preload policy. The mobile card containers have at least 16px page padding per side. Express that existing width in the two image sizes hints. Retain existing desktop breakpoints. No new abstraction or dependency.

## Success criteria

At the audited 412px viewport and 2.625 DPR, cards select 1080px images instead of 1200px while retaining enough pixels for their rendered width. Desktop selection remains unchanged. Rendered navigation and card text remain intact.

## Tasks

1. Correct both mobile sizes hints.
2. Render phone and desktop evidence; run relevant checks.
3. Record release note and parent review; close plan and push draft PR.
4. Mark ready and start ReviewGPT concurrently with CI; resolve results.

## Verification

Pending implementation.
