# Codex Runtime Removal Audit

## Goal

Recheck the Codex-only runtime cleanup against the original deletion list and remove any concrete missed residue that is still safe to cut.

## Scope

- Audit failover routes/provider state, OpenAI-compatible backend compatibility, removed setup flags, generic model discovery/provider catalog, per-turn assistant flags, hosted Vercel AI Gateway support, and local Codex app-server E2E shims.
- Preserve `murph model`, hosted Vercel AI Gateway support, Codex app-server E2E/local shims, Codex stale-resume resiliency, and multimodal/file evidence paths unless a verified dead surface remains.
- Do not edit unrelated active rows or historical release notes unless they affect live source/tests.

## Verification Plan

- Use focused subagent reviews plus local residue scans.
- Run focused tests/typechecks for any patched package owners.
- Run `git diff --check` before handoff.

## Result

- Removed missed failover diagnostics/runtime-state residue, stale setup/help surfaces, dead model-discovery helpers, and legacy assistant header/env helper exports.
- Preserved hosted Vercel AI Gateway, Murph model controls, Codex app-server E2E shims, and stale-resume behavior.
- Did not touch file-input, multimodal, attachment, or rich-content routing code after the user clarified that surface is intentionally out of scope.
- Verification passed: focused package typechecks/tests, root `pnpm typecheck`, residue scans, and `git diff --check`.
- No scoped commit from this lane because the shared checkout has broad overlapping dirty work across active rows.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
