---
title: 'Repository-tool CI serializes independent subprocess fixtures'
severity: 'minor'
---

## Expected Behavior

The repository-tool check should use a bounded portion of its existing CI runner while retaining its complete test inventory and failure behavior.

## Current Behavior

The shared CI default disables file parallelism. A controlled unchanged-source local comparison of the full 64-file, 908-test repository-tool suite took 248.05 seconds serially versus 123.35 seconds with two isolated workers. Combined CPU time stayed essentially unchanged; this does not establish Ubuntu or billing savings.

## Possible Solution

Set the existing file-parallelism and two-worker overrides only on the Host Support repository-tool step, after proving fixture isolation, diagnostics, and failure exit parity.

## Minimal Reproducible Example

On one checkout with frozen dependencies, run the repository-tool command with CI=true and MURPH_VITEST_FILE_PARALLELISM=0, MURPH_VITEST_MAX_WORKERS=1; then repeat with values 1 and 2. Restore the same Vitest scheduling cache before each run and avoid overlapping heavy work. Compare all test identities and outcomes, not only counts.

## Context

The candidate keeps all tests, assertions, timeouts, coverage, and required gates. Local negative probes retain assertion/collection diagnostics and nonzero exit propagation. Ubuntu CI remains the external validation boundary.
