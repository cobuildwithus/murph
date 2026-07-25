# Fix subagent hosted usage recording

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Restore durable hosted usage accounting for Codex subagent provider work
  without persisting provider thread identifiers or diagnostic wrapper fields.

## Success criteria

- Subagent usage drafts retain their existing provider-request ordinals and
  token totals.
- Every produced draft passes the public hosted usage parser unchanged.
- Focused package tests and the canonical diff-aware verification lane pass.
- The pushed PR completes the required preliminary and final ReviewGPT gates.

## Scope

- In scope: the assistant-engine subagent usage producer and focused regression
  tests.
- Out of scope: widening the hosted raw-usage allowlist, reconstructing
  historical dropped records, or changing Web persistence.

## Constraints

- Technical constraints: keep Web's token-only privacy boundary intact; preserve
  provider request ordinal identity and existing token-delta arithmetic.
- Product/process constraints: isolated PR lane, exact-head ReviewGPT, and
  Cloudflare runner rollout notes.

## Risks and mitigations

1. Risk: changing the payload could alter billing identity or token values.
   Mitigation: keep ordinal and scalar token fields unchanged and add a
   producer-to-parser round-trip regression.

## Tasks

1. Replace the invalid diagnostic wrapper with the existing flat token delta.
2. Delete wrapper-only counting plumbing and update focused tests.
3. Run canonical verification, open the PR, and complete review gates.

## Decisions

- The hosted-execution parser remains unchanged; it is the canonical privacy
  boundary and already accepts the flat token delta.

## Verification

- Commands to run: focused assistant-engine test, then
  `pnpm test:diff packages/assistant-engine/src/assistant/providers/helpers.ts
  packages/assistant-engine/src/assistant-codex.ts
  packages/assistant-engine/test/assistant-codex-subagent-usage.test.ts
  packages/assistant-engine/test/assistant-codex-runtime.test.ts`.
- Expected outcomes: all produced subagent records parse successfully and the
  affected owner plus reverse dependents pass.
- Results:
  - The focused extractor regression passed: 9 tests.
  - The focused runtime regressions passed: 5 tests.
  - Canonical `pnpm test:diff` passed all affected guards, typechecks, and the
    full assistant-engine owner suite: 172 files and 2,610 tests, with 5 skipped.
  - The canonical lane later reached unrelated assistant CLI coverage and stopped
    on pre-existing 60-second test timeouts plus unrelated experiment-journal
    assertions. GitHub CI provides the clean-environment reverse-dependent proof.
  - Preliminary ReviewGPT specialist review passed with no findings and confirmed
    the parser round trip, privacy boundary, failure path, cap, eviction, and
    ordinal coverage.
Completed: 2026-07-23
