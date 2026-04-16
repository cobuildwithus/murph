## Goal

Land the post-review cleanup patch for the hosted texting/debugging commits.

## Why

- Restore native provider/gateway web-search behavior for OpenAI-compatible targets while keeping the tool-name fix.
- Make held hosted auto-reply failures retry instead of stalling indefinitely.
- Trim sensitive hosted delivery logging that is broader than needed.
- Harden the local hosted dev harness so it stays useful without risky temp-dir or DB behavior.

## Scope

- `packages/assistant-engine/**` only for the OpenAI-compatible tool/search path and auto-reply retry behavior
- `packages/assistant-runtime/**` only as needed to align hosted Linq/maintenance behavior
- `apps/cloudflare/**` only for hosted delivery / finalize logging cleanup
- `scripts/dev-hosted-local/**` only for local harness safety fixes

## Constraints

- Keep the patch focused on cleanup and simplification, not broader hosted refactors.
- Preserve the local end-to-end harness and the already-landed production bug fix.
- Avoid weakening provider/runtime behavior outside the reviewed follow-up areas.

## Verification

- Focused tests for assistant-engine, assistant-runtime, Cloudflare, and dev harness changes
- `pnpm typecheck`
- final clean `git status --short`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
