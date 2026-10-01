# Simplify Codex attempt capability construction

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce branching in the Codex attempt runner while preserving the complete provider request, attempt lifecycle, usage attribution, cancellation, and failure evidence.

## Scope and owner

The existing assistant-engine runner owns provider request construction and attempt outcomes. Keep the change inside that owner with private helpers and focused runner regressions. Planning, tool declarations, prompts, external protocols, and persisted state retain their existing owners.

## Evidence and design

The attempt function repeats the same restriction families across environment, hosted ports, network ports, permissions, and thread configuration. Derive those shared predicates once, keep precedence explicit, and separate request assembly from result/error handling. Do not add a policy framework or state owner.

## Protected invariants

- Preserve output-only, creative song, maintenance, read-only automation, group-email, and ordinary hosted/local capability differences, including overlapping conditions.
- Preserve request order, service-tier deadlines, live callbacks, optional field presence, failed-attempt metadata, and accepted-input release.
- Add no awaited work, provider calls, database reads, retries, or persistent state.
- No deployment ordering or schema compatibility change; old and new code construct the same requests.

## Tasks

1. Consolidate capability policy and separate provider request construction from attempt lifecycle.
2. Extend composed runner tests for overlap precedence and authority mismatches.
3. Run focused runner tests, relevant typecheck, and complexity guard; inspect full diff and privacy.
4. Close this implementation plan, commit, push, and open a draft PR for parent review and final gates.

## Verification

Use assistant-codex-final-coverage.test.ts for real runner construction and outcomes, plus focused contract checks where needed. Run assistant-engine typecheck and pnpm complexity:diff. Existing behavior and provider inputs must remain identical. Assess real-model proof after deterministic checks; this refactor changes no authored prompts, schemas, tool eligibility, or reply policy.

## Results

- Introduced private capability classification and ordered thread/permission selectors; derived the shared hosted, tool, and internet restrictions once.
- Separated provider input assembly from the attempt lifecycle. Result and failure handling remains byte-identical to base.
- Expanded output-only/follow-up overlap and all four maintenance-authority/follow-up combinations; existing ordinary, creative, memory, Habitat, onboarding, group email, Flex, usage, and diagnostics assertions remain.
- Focused runner and authority suites: 33 tests passed on candidate and on the original runner with the same expanded assertions.
- Assistant-engine typecheck passed with one checker. Diff whitespace and changed-line privacy inspection passed.
- Complexity guard passed: executeAssistantCodexAttempt 132 to 24; file maximum 132 to 64; debt 112 to 49. Remaining hotspots are request assembly (64), attempt lifecycle (24), and capability classification (21). Further splitting would chiefly move optional-field defaults or the coupled attempt failure state rather than simplify policy.
- No live-model run: composed provider inputs, prompt text, tool/schema declarations, and reply policy retain their existing semantics; deterministic runner proof directly covers the refactored boundary.
- Internal refactor only, so no public changelog. Parent owns draft candidate review, ReviewGPT, and exact-head CI.
Completed: 2026-09-11
