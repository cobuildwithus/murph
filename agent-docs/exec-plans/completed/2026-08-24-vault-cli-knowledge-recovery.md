# Vault CLI Knowledge And Provider Recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

Give query, canonical-memory, Exa research, and Health Commons protocol commands
stable privacy-safe failures that tell a model whether to repair local source,
retry provider work, or continue without optional corpus context.

## Root Cause

- Query-owned metadata, Markdown, and JSONL readers let parser exceptions escape
  without a stable domain category or exact vault-relative repair location.
- Canonical memory parsing and missing-record updates throw generic errors even
  though the owning document and operation are known.
- Exa request failures retain a safe status and stage internally but collapse
  auth, rate limiting, provider outages, timeouts, and malformed success into
  one non-retryable error.
- Health Commons protocol readers let missing or corrupt generated-artifact
  exceptions escape with no safe continuation category.

## Architecture

- Query remains the owner of canonical-source parse facts and exposes one typed
  source error with only a bounded vault-relative path, optional line, and safe
  parser category. Vault-usecases maps that lower-owner error to the existing
  `VaultCliError` repair envelope without changing the shared transport.
- The memory contract owns typed document-parse facts; core owns update and
  read-after-write failures. The memory CLI maps those known errors at its
  existing boundary.
- The Exa client classifies only safe transport facts already available at the
  provider boundary and validates the minimum successful response shape before
  returning it. Provider bodies and arbitrary causes remain excluded.
- Commons protocol commands map generated-artifact load failures to stable safe
  categories. Knowledge search keeps its existing successful unavailable
  result because corpus context is optional there.
- No telemetry service, retry loop, new persisted state, shared transport edit,
  or provider response serializer is added.

## Product UX Patch

- Outcome: a model can repair one corrupt local source, make a truthful provider
  retry decision, or continue without optional Commons context instead of
  receiving a generic failure.
- Reaches: existing Vault CLI query/read, memory, research scout, and Commons
  protocol command journeys.
- Proof: focused final-envelope tests cover source/line guidance, stable
  not-found, auth/rate/outage/timeout/malformed-success retryability,
  Commons degradation, and non-echo of payloads, provider bodies, causes, and
  absolute paths.

## Verification

- Add lower-owner unit coverage for query source and memory parse categories.
- Add CLI envelope tests for every new mapping and privacy non-echo boundary.
- Run focused package tests plus typechecks for contracts, core, query,
  vault-usecases, and CLI.
- Inspect the final diff, privacy boundary, and categorized added/deleted LOC
  before the scoped commit.

## Progress

- Verified exclusive local ownership and no overlapping open PR beyond the
  shared error foundation and source audit.
- Created the sanctioned task worktree and rebased the completed patch onto the
  integration owner's exact updated foundation commit without conflicts.
- Added typed query-source and canonical-memory errors with bounded
  vault-relative path, optional line, stable category, and value-free field
  guidance.
- Added Exa auth, rate-limit, provider-unavailable, timeout, caller-abort,
  rejected-request, and malformed-success classifications with explicit
  retryability and no provider-body projection.
- Added safe Commons protocol artifact unavailable/invalid categories while
  preserving graceful unavailable results for optional knowledge search.
- Replayed four journeys: repairing malformed canonical query and memory
  sources, retrying a temporary Exa failure, fixing Exa authentication instead
  of looping, and continuing without unavailable Commons protocol context.
- Focused CLI envelope tests passed: 54 tests. Focused contracts, core, and
  query tests passed: 40, 10, and 18 tests respectively. Typechecks passed for
  contracts, core, query, vault-usecases, and CLI.
Completed: 2026-08-24
Completed: 2026-08-24
