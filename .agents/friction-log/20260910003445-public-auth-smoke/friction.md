---
title: 'Public auth smoke passes despite experiment-library server rendering failure'
severity: 'minor'
---

## Expected Behavior

The public auth browser gate should distinguish a healthy server render from a 200 response that recovers in the browser.

## Current Behavior

Navigating to /experiments in the existing smoke environment emits React's invalid-element server-render error, returns 200, and recovers through client rendering. The public auth spec still passes because it checks HTTP status and script loading. The same result reproduces on the unchanged parent branch and on the authentication adoption candidate.

## Possible Solution

Investigate the experiment library's undefined render dependency separately and add a meaningful page-render assertion to its owner test. Preserve the auth test's focused purpose.

## Minimal Reproducible Example

Run e2e/pr-public-auth-loading-design-proof.spec.ts through apps/web/playwright.config.ts at the 412px case with a synthetic local database and the smoke environment. Inspect the /experiments server-render diagnostics alongside the passing result.

## Context

Found while verifying authentication adoption. The identical parent-branch failure establishes that this migration did not introduce it; phone/email authentication and retry proof passes separately.
