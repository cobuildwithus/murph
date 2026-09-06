---
title: 'Cloudflare composite test script drops focused file filters'
severity: 'minor'
issue: 'cobuildwithus/murph#2994'
---

## Expected Behavior

A package test command with a positional filename should restrict verification to that file.

## Current Behavior

`pnpm --dir apps/cloudflare test test/workspace-snapshot-local.test.ts` starts the entire Node workspace. The nested shell chain forwards the filename only to the final Containers helper command. This happens without an extra double-dash separator, unlike the existing separator issue.

## Possible Solution

Document the direct focused invocation or forward filters through both composite script stages. The working command is `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/workspace-snapshot-local.test.ts` from the repository root.

## Minimal Reproducible Example

Compare the package command above with the direct Vitest invocation. The former schedules every Node workspace file; the latter runs the requested snapshot file.

## Context

A snapshot storage change required focused encryption/restore proof. Unexpected suite expansion also rebuilt runner artifacts while source edits continued, producing a stale source-fingerprint failure. The direct snapshot run passed all 23 tests.
