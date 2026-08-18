---
title: 'Next production runner couples TypeScript and Webpack heap budgets'
severity: 'minor'
---

## Expected Behavior

The hosted Web production build should give Next's compatibility typecheck and Webpack compiler independent memory budgets while preserving both checks.

## Current Behavior

Next forwards one `NODE_OPTIONS` heap limit to both workers. A cold TypeScript 5 route and page contract check exhausts a 3 GiB heap, while raising the shared limit to 3.5 GiB makes cold Vercel builds intermittently exceed the 8 GiB builder and terminate the compiler.

## Possible Solution

Keep route generation and the app-local TypeScript 5 contract check as an explicit fail-closed phase, then run the ordinary Next build with a smaller worker heap and suppress only its already-proven duplicate check.

## Minimal Reproducible Example

1. Remove the hosted Web `.next` directory.
2. Run the production Next build with a 3 GiB inherited worker heap; the compatibility typecheck can exhaust its heap.
3. Repeat with a 3.5 GiB inherited worker heap in a cold 8 GiB build environment; the compiler can be terminated for aggregate memory pressure.

## Context

This blocked exact-head PR CI and made repeated cold deployment previews nondeterministic even though the source and route contracts were valid.
