---
title: 'Package typecheck accepts a sibling source import that package build rejects'
severity: 'minor'
---

## Observed

A type-only import from a declared sibling workspace package passed the importing package’s `typecheck`, but the same package failed during the production runner build because TypeScript resolved the sibling source outside the importer rootDir.

## Reproduction

1. Add a type-only import from a sibling package public subpath.
2. Run the importing package typecheck; it passes.
3. Run the importing package build (or production runner assembly); TS6059/TS6307 reject the sibling source files.

## Expected

The focused package typecheck should exercise the same public-entrypoint/rootDir boundary as the package build, or report that the build is the required boundary check.

## Impact

Focused verification can report green before a later production assembly pays the full workspace build cost and reveals the boundary failure.
