# Assistant memory hardening

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Harden assistant memory so writes bind to the real current user turn, run through a native Codex MCP tool path instead of shelling out, support explicit forgetting, and serialize cross-process assistant-memory commits.

## Success criteria

- In provider-backed assistant sessions, assistant-memory writes no longer trust model-supplied source wording; the host binds writes to the actual active user turn.
- Codex exec sessions expose assistant-memory operations as MCP tools rather than requiring shell CLI commands for memory search/get/write.
- Assistant memory supports an explicit forget/delete path that removes mistaken or obsolete memory.
- Assistant-memory writes carry minimal provenance metadata and are protected by a vault-scoped write lock across concurrent assistant processes.
- Legacy heuristic post-turn memory writing is no longer part of the public runtime surface.
- Focused tests and architecture/runtime docs cover the revised trust boundary and execution defaults.

## Scope

- In scope:
  - assistant memory bridge/service/runtime changes for turn-bound provenance and write serialization
  - Codex exec wiring for MCP-backed Healthy Bob CLI tools
  - assistant memory command/contracts updates for explicit forget/delete
  - focused assistant tests and matching architecture/runtime docs
- Out of scope:
  - canonical vault writes derived from assistant memory
  - vector/embedding memory
  - broad non-memory MCP tooling redesign beyond the bounded assistant-memory path

## Constraints

- Keep assistant memory Markdown-backed under `assistant-state/` and outside the canonical vault.
- Keep the host as the final policy enforcement point for sectioning, privacy, dedupe, replacement, delete semantics, and provenance binding.
- Preserve existing assistant session reuse, transcript storage, and channel delivery behavior.
- Prefer bounded changes that work with the existing Incur/Codex surface already present in the repo.

## Risks and mitigations

1. Risk: MCP wiring depends on Codex config override behavior and could break exec startup.
   Mitigation: keep the change behind deterministic argument construction with focused `assistant-codex` tests.
2. Risk: delete semantics could accidentally remove unrelated nearby memory.
   Mitigation: delete by exact record id, reload records after commit, and add focused tests for long-term and daily memory removal.
3. Risk: provenance metadata could bloat or destabilize the Markdown format.
   Mitigation: keep metadata minimal, machine-readable, and derived from the active host turn rather than model text.

## Tasks

1. Add an active assistant-memory execution context that binds turn/session provenance server-side.
2. Rework Codex exec setup to expose Healthy Bob assistant-memory commands as MCP tools and adjust default sandbox/approval behavior.
3. Add `assistant memory forget` plus storage/locking/provenance support in the memory commit layer.
4. Remove the public legacy heuristic writer path if tests confirm no live runtime uses remain.
5. Update focused tests and architecture/runtime docs.
6. Run simplify, coverage audit, required checks, final review, then remove the coordination row and commit the exact touched files.
Completed: 2026-03-18
