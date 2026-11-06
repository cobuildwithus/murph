---
title: 'Runner bundle assembly cannot request offline dependency resolution'
severity: 'minor'
---

## Expected Behavior

A fully installed checkout can assemble its pinned runner bundle without registry access when validation requires an offline run.

## Current Behavior

The bundle's lockfile-only install attempts optional native-package metadata resolution even when the root dependencies are cached. Its sanitized package-manager environment drops an inherited offline setting.

## Possible Solution

Provide an explicit offline assembly option that reaches the isolated install process without weakening dependency or patch checks.

## Minimal Reproducible Example

Install the workspace, set npm_config_offline=true, and run pnpm --dir apps/cloudflare runner:bundle. The nested install can still attempt registry metadata requests.

## Context

Deletion verification requires a before/after runner package inventory without registry access. A task-local pnpm wrapper supplies --offline to nested install commands.
