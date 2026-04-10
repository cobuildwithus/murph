# Linq Product Copy To iMessage

## Goal

Replace user-facing product-copy mentions of `Linq` with `iMessage` across the current repo surfaces, while leaving technical/vendor/runtime references to the Linq integration unchanged.

## Why

- The requested messaging-app copy should present `iMessage` instead of `Linq` anywhere the product is described to users.
- The repo still contains many real Linq implementation surfaces, so this pass needs to be selective rather than a blind global rename.

## Scope

- hosted homepage and metadata copy under `apps/web/**`
- hosted legal/product-marketing copy under `apps/web/legal/**` and `agent-docs/product-marketing-context.md`
- no runtime, API, schema, env, or implementation renames

## Constraints

- Preserve unrelated dirty worktree edits, especially existing homepage changes already in progress.
- Do not change technical references that describe the Linq provider, webhook routes, env vars, payloads, or tests.
- Keep the change narrow enough for a single scoped commit.

## Verification

- `bash scripts/workspace-verify.sh test:diff <touched paths>`
- inspect the final diff for accidental scope creep or identifier leakage

## Result

- Remaining `Linq` matches in the targeted product-copy surfaces were reduced to the technical hosted webhook route path only.
- Scoped hosted-web verification passed on the exact touched paths.

## Commit Plan

- Use `bash scripts/finish-task` while this plan remains active so the completed plan artifact ships with the scoped commit.

Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
Completed: 2026-04-10
