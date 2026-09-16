---
title: 'Native hosted-local migration inspection rejects Miniflare metadata'
severity: 'minor'
---

## Expected Behavior

The local native handoff rehearsal should recognize supported runner schemas while retaining rejection of unknown application state.

## Current Behavior

Wrangler's Miniflare wrapper adds its exact __miniflare_do_name metadata table for named Durable Objects. The source inspector counts it as an application table and returns unsupported_schema even at schema version 21. The Workers unit-test runtime does not automatically add this wrapper table, so its positive case passed while the native rehearsal failed.

## Possible Solution

Exclude that exact platform-owned table during observational discovery and exercise it alongside unknown application tables in the actual Workers runtime.

## Minimal Reproducible Example

Initialize a synthetic schema-21 runner and create the Miniflare metadata table with its documented id and name columns. Observe the source without mutating it. The native equivalent is the rolling-migration process of the postgres-runtime-warm-reuse hosted-local scenario.

## Context

This blocks the local checkpoint, member handoff, and cold/warm reply rehearsal before migration begins. No production data is needed to reproduce it.
