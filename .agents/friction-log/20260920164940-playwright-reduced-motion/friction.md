---
title: 'Playwright reduced-motion default uses an unsupported config option'
severity: 'minor'
---

## Expected Behavior

The shared Web Playwright configuration should typecheck when reused and apply its documented reduced-motion default.

## Current Behavior

The configuration places reducedMotion directly under use, but Playwright's typed fixture API expects contextOptions.reducedMotion. The app excludes this config from typechecking, so importing it from a scoped browser config reveals TS2769. The intended browser-context default was not configured through the supported property.

## Possible Solution

Move reducedMotion into use.contextOptions and reuse the shared server configuration from the scoped cross-browser proof.

## Minimal Reproducible Example

Import apps/web/playwright.config.ts from an included TypeScript module, then run the hosted Web typecheck. The use.reducedMotion field fails the defineConfig overload.

## Context

Found while adding Chromium, Firefox, and WebKit coverage to a design-only canvas playground. Correcting the property keeps the existing intended reduced-motion policy explicit.
