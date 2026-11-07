---
title: 'Reduced runner assembly requires the CLI package it excludes'
severity: 'minor'
---

## Expected Behavior

The runner assembly option --skip-bundle-only-dependencies should complete with its declared reduced workspace set, or reject that unsupported mode before building and installing packages.

## Current Behavior

The reduced workspace closure excludes @murphai/murph. Assembly still calls bundleInstalledVaultCliBinary unconditionally, which requires that package's dist/bin.js and fails with ENOENT after building, packing and installing dependencies. The entrypoint bundle guard never runs.

## Minimal Reproducible Example

Run pnpm --dir apps/cloudflare runner:bundle --skip-bundle-only-dependencies in an installed checkout. The full runner:bundle command succeeds in the same checkout.

## Context

The failure prevents collecting before/after full-assembly equivalence evidence for a packaging simplification. Reduced dependency closure, build closure and staged root dependency evidence remain available, but they do not prove a completed reduced runner bundle.
