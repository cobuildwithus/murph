---
title: 'Provider-request guard falls back to filenames for fixed-host URL templates'
severity: 'minor'
---

## Expected Behavior

A request with a literal GitHub HTTPS authority and dynamic repository/path segments should be recognized as a GitHub transport rather than as a wearable-provider request.

## Current Behavior

The provider-request boundary guard resolves only complete static URL strings. A URL template with dynamic path segments falls back to provider words in the filename, so a GitHub workflow dispatcher whose feature name contains Junction fails the guard despite making requests only to GitHub.

## Possible Solution

Keep GitHub-only dispatchers named for their transport owner. If this recurs, separately consider proving a literal authority before the first template interpolation without relaxing dynamic-host fallback.

## Minimal Reproducible Example

Scan a source named `scripts/junction-example.mjs` with `findProviderRequestBoundaryViolations`:

```js
async function requestGithub(fetchImpl, path) {
  return fetchImpl(`https://api.github.com/repos/${path}`);
}
```

The guard labels the call Junction HTTP even though the authority is statically GitHub.

## Context

The failure blocked the release build/typecheck aggregate for an otherwise passing live-canary implementation. Renaming the GitHub-only controller and asserting its fixed origin in behavior tests avoids changing provider policy.
