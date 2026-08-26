# PR 2208 current-main integration

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

Ship the knowledge, memory, Query, Commons, and research recovery slice on
current `main` while preserving one shared projector, bounded owner-approved
fields, terminal read semantics, and no failed-read writes.

## Evidence

- PR 2208 is Draft at exact clean head
  `0083ba3043232b8351b8b82fa45311f7e13566d3`; its branch, upstream, worktree,
  and GitHub head agree, with no competing handoff record.
- Historical review found and corrected Markdown strictness, Commons artifact
  classification, and duplicate Query projection ownership.
- Round four found the historical foundation snapshot had partially introduced
  `publicPath`, leaving existing `issues.path` producers without actionable
  validation metadata. Current `main` now owns the final shared projection
  contract; integration must delete the branch's stale shared-owner copy rather
  than add another compatibility path.
- The existing exact-head branch proof covers memory no-echo/no-write behavior,
  Query and Commons classification, research provider failures, CLI package
  shape, and runner parity, but predates current `main` integration.
- Current `main` was merged at `3823c788fd`. Shared projector, bridge,
  assistant guidance, bundle scaffolding, and generic redaction conflicts were
  resolved to `main`; Query strict/tolerant parsing was composed with current
  AbortSignal ownership in the Query reader.
- Stale branch-only expectations that arbitrary errors and a fixed provider
  route be redacted were deleted. Query and Commons retain their finite typed
  projection, while invalid typed detail falls back to current `main` without
  serializing the untrusted detail object.
- Focused proof passes: 130 Query tests, 65 CLI knowledge-domain tests, 80
  supporting domain tests, all six affected package typechecks, prepared
  runtime generation, CLI package shape, and the 14-test runner bundle suite.
- Canonical runner assembly passes all eight parity probes. The Vault CLI is
  9,516,785 bytes against a composed 9,525,527-byte budget; the runner is
  11,346,601 bytes against an 11,393,617-byte budget. Entry and static-startup
  limits remain unchanged.
- The next exact-head review found that post-write read/parse failures and stale
  read-backs did not all converge on the existing `MemoryPersistenceError`.
  One private read-back boundary now verifies the exact rendered Markdown for
  upsert, update, set-name, and forget; every failure after the canonical write
  is terminal persistence uncertainty, while all pre-write reads remain outside
  that boundary.
- Core memory proof passes 10/10 and CLI memory proof passes 11/11, including
  one persisted write, malformed/stale read-back, terminal inspect-first
  guidance, non-echo, and byte-identical no-write behavior for pre-write parse
  failure. Core and CLI typechecks plus `git diff --check` pass.

## Design

- Current `main` owns shared projection, generic recovery guidance, bridges,
  Incur transport, and bundle topology.
- Knowledge-domain owners retain only their classifications: strict or tolerant
  Markdown reads, Query source failures, Commons artifact availability, memory
  document read failures, and typed research-provider outcomes.
- Reuse the current owner-approved public-path contract. Add no second
  projector, path migration layer, generic context serializer, retry manager,
  repair service, state owner, or compatibility shim.

## Product UX

- Effort: Patch.
- Person/path: an assistant reading malformed memory, querying an unsupported or
  invalid Vault source, loading unavailable Commons artifacts, or handling a
  typed research-provider failure.
- Result: one truthful safe disposition with a bounded recovery field where the
  domain owner can name it, no canonical content or provider body, and no
  unchanged write retry.
- Recovery proof: replay built full-envelope failures and prove rejected reads
  and preflights perform no write.

## Tasks

1. [done] Merge current `main` and resolve duplicate foundation history by ownership.
2. [done] Prove the resulting diff contains only the knowledge-domain slice, authored
   plan history, and measured bundle allowance.
3. [done] Run focused domain and shared-boundary tests, affected typechecks, prepared
   runtime/package-shape checks, docs gates, and canonical runner parity proof.
4. Push the exact candidate, update the PR contract, and run a sensitive full
   ReviewGPT round with the immutable prior-finding ledger.
5. Resolve accepted findings, close the plan, admit the PR to CI, and merge.
