# Assistant Runtime Context Cutover

## Goal

Hard-cut assistant execution over to explicit runtime context and provider-attempt metadata so assistant-core no longer depends on ambient hosted `process.env` mutation or provider-specific tool-executed error decoration.

## Why

- `persistPendingAssistantUsageEvent()` currently infers hosted identity and user-env ownership from `process.env`, which makes hosted usage capture depend on runtime-global mutation rather than explicit execution context.
- Hosted share issuance currently reads the hosted sender member id from `process.env` inside assistant-core tool definitions for the same reason.
- Post-tool failover safety currently depends on OpenAI-compatible provider code mutating thrown errors, which couples no-replay failover classification to one provider implementation.
- This is a greenfield cutover, so we can remove the old seams instead of carrying compatibility paths.

## Scope

- assistant-core service/runtime context plumbing
- assistant-core usage persistence and hosted share tool context
- provider execution result types and provider-turn failover classification
- focused hosted runtime and assistant CLI/runtime tests covering the touched seams

## Constraints

- No legacy compatibility branches for ambient hosted env reads or provider-specific tool-executed error markers.
- Keep hosted runtime env mutation only for child/runtime behavior that genuinely requires environment variables; assistant-core internal APIs should not use it.
- Preserve the existing no-replay rule: once a bound assistant tool executes in an attempt, same-turn failover must stop.
- Preserve unrelated dirty-tree edits and avoid widening into the active query or hosted Linq webhook work.

## Verification

- Focused assistant and hosted-runtime regression tests for explicit hosted context and tool-executed failover classification
- package-local typechecks for touched packages
- repo-required verification commands, with explicit handoff if unrelated branch failures remain

## Commit Plan

- Use `scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
