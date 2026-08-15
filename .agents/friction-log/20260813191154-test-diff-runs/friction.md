---
title: 'test:diff runs unprepared full CLI package tests for prompt-only tooling changes'
severity: 'major'
issue: 'cobuildwithus/murph#1798'
---

## What happened

Running `pnpm test:diff` for two ReviewGPT Markdown presets and their focused contract test passed repo-tool tests and the affected package typecheck, then expanded to the entire CLI package test suite. A fresh sanctioned worktree lacked prepared CLI runtime artifacts and generated Health Commons artifacts, so one repair-lock timeout cascaded into 141 unrelated failures and roughly 2.5 hours of runtime.

## Expected

The low-risk repo-internal workflow/tooling lane should stop after focused repo-tool tests and typecheck for a prompt-contract-only change, or prepare every artifact its affected-package tests require before launching those tests.

## Impact

The advertised scoped verifier is disproportionately slow and red for prompt-only changes despite a green focused contract test, obscuring useful validation and consuming substantial local resources.

## Reproduction

From a fresh sanctioned worktree with dependencies installed, edit only `scripts/chatgpt-review-presets/*.md` plus the matching prompt-contract assertions in `packages/cli/test/release-script-coverage-audit.test.ts`, then run `pnpm test:diff` with those paths.
