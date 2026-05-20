# Hosted iMessage Typing Loop

## Goal

Stop the hosted-local post-reply idle-wake loop that keeps refreshing visible iMessage/Linq typing/activity indicators after Murph has already delivered a reply.

Success criteria:

- The live local loop is stopped.
- Runtime logs and DB metadata explain the loop without exposing payloads, user ids, provider tokens, or local paths.
- Stale post-reply scheduled wakes no longer keep a hosted runtime invocation dirty after no fresh input or automation work occurs.
- A focused hosted-local Linq E2E reproduces the loop with runtime wake probes.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- Local metadata-only DB/Docker diagnostics

## Findings

- Local DB showed four delivery summaries but hundreds of assistant pass/deferred-checkpoint entries in the same local debug window.
- Docker logs showed one active runner repeatedly accepting `idle-wake` passes about once per second.
- Those passes had no fresh input and no automation work, but the assistant phase still returned progress when it consumed the same due workspace wake from an uncheckpointed workspace.
- Because the dirty-window loop resets its idle checkpoint deadline on every dirty result, repeated runtime wake probes can prevent the checkpoint that would otherwise clear the stale visible wake.
- A hosted-local Linq E2E reproduced the stale-wake loop before the fix: the alarm did not settle under runtime wake probes.

## Plan

1. Add a hosted-local Linq E2E that reproduces the stale scheduled wake loop with a longer dirty checkpoint window and runtime wake probes.
2. Prevent no-op consumption of a stale due workspace wake from marking assistant phase progress.
3. Preserve real wake progress when fresh input, device-sync retry rearming, provider cleanup, delivery, or a future assistant wake is present.
4. Run the focused E2E/unit tests and repo-required verification.

## Verification

- Failed before fix: focused hosted-local Linq stale scheduled wake E2E.
- Passed after fix: focused hosted-local Linq stale scheduled wake E2E.
- Passed: `packages/assistant-runtime` test and typecheck.
- Passed: `apps/cloudflare` typecheck.
- Passed: repo `typecheck`.
- `test:diff` is blocked by an unrelated untracked device-sync reconnect notice log-guard finding; rebuilding `packages/core` cleared the transient CLI missing-dist failures and `packages/cli test` passed.

## Coordination

Overlaps active hosted runner/runtime diagnostics work in `workspace-assistant-phase.ts`; keep the change narrow and preserve diagnostic logging behavior.
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
