---
title: 'Cold Web builds cannot resolve the declared clinical-records usecase export'
severity: 'minor'
issue: 'cobuildwithus/murph#3971'
---

## Expected Behavior

The canonical Web build should typecheck its existing clinical-records test on a clean checkout without requiring a prebuilt vault-usecases dist directory.

## Current Behavior

The Web tsconfig overrides the root paths map and omits @murphai/vault-usecases/clinical-records. The package declares that public export, but a fresh Web build resolves its absent dist declaration and fails with TS2307. Both production admission and its private fallback fail before Web compilation; warm local package output can hide the gap.

## Possible Solution

Add the exact declared public subpath to the existing Web source-resolution map, matching the established workspace convention. Retain the real cold Web build and clinical retrieval tests as proof.

## Minimal Reproducible Example

In a clean checkout, install frozen dependencies, prepare hosted-execution, and run the canonical Web build with the existing synthetic integration environment. The Web typecheck reports TS2307 in test/clinical-records-retrieval.test.ts.

## Context

Observed in public production admission run 36952109269 and the preceding main admission's private Web build. This blocks deployment and reusable public build publication.
