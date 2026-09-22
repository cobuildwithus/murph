# Reduce avoidable food and group reply work

Status: active
Created: 2026-09-22
Updated: 2026-09-22

## Goal

- Reduce avoidable CLI validation recovery, oversized tool output, and serial assistant work in food capture and group replies.

## Success criteria

- Reproduce each changed boundary with synthetic inputs; preserve grounded nutrition, exact writes, and group disclosure authority.
- Pass focused CLI and prompt tests, relevant typechecks, and production-derived live assistant journeys.
- Review, publish, and ship the scoped change through required repository gates.

## Scope

- In scope: existing food CLI schemas/help, bounded result contracts, food and group instructions, and focused proof.
- Out of scope: model changes, new schedulers, broad group identity redesign, private data in artifacts.

## Constraints

- Technical constraints: use existing command/provider owners; add no persistent state or dependencies. Keep compatibility and read/write authority explicit.
- Product/process constraints: keep routine replies concise; improve actual work rather than merely suppressing alerts. Private Ops evidence remains outside repository artifacts.

## Risks and mitigations

1. Narrower output can omit needed evidence. Preserve an explicit detailed read and prove nutrition/provenance and disclosure invariants.
2. Instructions can contradict loaded skills. Test composed production instructions before focused live proof.

## Tasks

1. Request bounded Ops diagnostics and inspect current CLI/prompt owners; derive independent synthetic reproductions.
2. Implement the smallest evidence-backed corrections and deterministic regressions.
3. Run focused typechecks and live journeys; inspect replies and owned effects.
4. Review privacy and complexity, close the plan, commit, and ship through required checks.

## Decisions

- Canonical state stays with existing meal and hosted group owners. Single-food lookup accepts a documented named query alias; missing or conflicting forms fail with actionable syntax guidance.
- Outcome: complete routine capture and group reads with fewer avoidable round trips.
- Reaches: private meal logging and authorized group replies, including invalid lookup syntax and bounded missing-data recovery.
- Proof: synthetic CLI/provider tests and real assistant journeys with production instructions, exact effects, and concise truthful replies.

## Verification

- Focused CLI and assistant-engine Vitest suites; package typechecks; named live assistant journeys; diff/complexity and required exact-head CI.
- Expected outcomes: first-attempt valid command syntax, bounded returned evidence, no duplicate writes or unauthorized group data, useful final replies.
