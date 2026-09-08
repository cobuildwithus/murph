# Match experiment image downloads to mobile cards

Status: completed
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

- Existing card and changelog tests: 4 files, 76 tests passed. Final changelog provenance test: 9 passed.
- Web typecheck and changed-file ESLint passed. Fresh worktree preparation reused `pnpm --dir packages/device-syncd build` for the existing service declaration artifact.
- `pnpm complexity:diff`: passed with no hotspots above 20. `pnpm test:frontend-design-proof`: 12 passed.
- `pr-experiment-image-sizes-design-proof.spec.ts`: 2 Chromium tests passed at 412px / 2.625 DPR and 1440px / 1 DPR.
- All six sampled mobile cards selected 1080px images; featured images render at 378px and browse images at 380px. The selected source exceeds their 992.25px / 997.5px device-pixel demand. Desktop featured cards selected 750px for 526px rendered width; browse cards selected 384px for 253px rendered width, preserving the existing desktop hints.
- Native card crops were inspected at both viewports. No asset or quality change.
- The production audit compared six image encodings at 1200px and 1080px and found 91,776 fewer bytes (14.7%). Current featured ordering differs from that audit; the browser proof claims actual width selection, not that exact page-byte saving for every catalog ordering.

## Product UX walkthrough

Ready: actual experiment navigation and images render at phone and desktop widths with sufficient source pixels. Loading and preload behavior, links, private-run treatment, and card content stay with their current owners. The component catalog adds a synthetic instance of each existing card for a stable review anchor.

## Review handoff

PR #2910. A Vercel preview supplies the new component-catalog link. Exact-head CI and ReviewGPT outcomes are tracked on the PR; this plan records local implementation proof.
Completed: 2026-09-05
