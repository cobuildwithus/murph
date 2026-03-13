# Execution Plan: Core FS Write Boundary

## Goal

Factor repeated vault write-boundary preparation inside `packages/core/src/fs.ts` into small internal helpers while keeping public APIs, path-policy enforcement, error codes/messages, and returned relative paths unchanged.

## Scope

- In scope:
  - `packages/core/src/fs.ts`
  - Internal helper extraction for verified write-target preparation
  - Internal helper extraction for immutable raw write existing-target handling
- Out of scope:
  - Public API changes
  - Path-policy behavior changes
  - Test file edits already owned by another active lane unless ownership is explicitly transferred

## Constraints

- Keep raw-write vs append-only eligibility exactly as-is.
- Preserve:
  - `VAULT_RAW_IMMUTABLE`
  - `VAULT_APPEND_ONLY_PATH`
  - `VAULT_FILE_EXISTS`
  - `VAULT_RAW_PATH_REQUIRED`
- Preserve equality behavior:
  - byte equality for copied raw files
  - exact UTF-8 equality for immutable JSON writes

## Plan

1. Inspect `packages/core/src/fs.ts` to identify the repeated trust-boundary sequence and current immutable-raw branching.
2. Extract a small internal helper for resolve/assert/ensure-parent/reassert flow and apply it to all write entry points.
3. Extract a small internal helper for shared immutable raw existing-target handling while preserving current exceptions.
4. Run required verification plus completion-workflow audit passes, then remove the ledger row when complete.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
