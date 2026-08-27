# Accept Codex 0.149.1 token usage shape

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Preserve valid Codex App Server token-usage events so Murph records accurate
  usage, allowance, cost, and billing inputs when upstream omits defaulted or
  optional fields.

## Success criteria

- The current Codex 0.149.1 token-usage shape is accepted.
- Omitted `cacheWriteInputTokens` values normalize to `0` in both `last` and
  `total` usage.
- An omitted or explicit-null `modelContextWindow` normalizes to `null`.
- Additive upstream fields do not discard otherwise valid known usage.
- Missing or invalid required counters and invalid known optional fields still
  fail closed.
- A raw protocol event with both omissions reaches downstream provider-usage
  extraction with exact non-null counters.
- Focused tests, package typecheck, required review gates, and exact-head CI pass.

## Scope

- In scope: the shared Codex App Server token-usage reader and deterministic
  Assistant Engine protocol/accounting regressions.
- Out of scope: changing usage pricing, allowance policy, persistence schemas,
  Codex dependency versions, or unrelated protocol readers.

## Constraints

- Technical constraints: keep one normalized internal shape for every existing
  root-turn, profile, and subagent consumer; ignore only additive fields while
  validating every known consumed field.
- Product/process constraints: smallest owner-boundary fix, no new dependency,
  state owner, compatibility service, or duplicated upstream schema mechanism.

## Risks and mitigations

1. Risk: permissive parsing could admit malformed accounting values.
   Mitigation: required counters remain exact non-negative safe integers, and a
   present known optional field must also be a non-negative safe integer or null
   where upstream permits null.
2. Risk: compact test fixtures could silently fill the omitted upstream fields
   and mask a regression again.
   Mitigation: stop synthesizing those optional fields in the shared fixture
   helper and add a raw extraction regression that bypasses fixture completion.

## Tasks

1. Prove the current reader rejects the pinned upstream schema shape.
2. Normalize omitted optional/defaulted fields at the shared protocol boundary
   while tolerating additive payload fields.
3. Replace the brittle complete-shape assertion with table-driven required,
   optional, invalid, and additive-field protocol coverage.
4. Add raw downstream usage-extraction proof and run focused verification.
5. Complete ReviewGPT, CI, parent review, plan closure, and scoped commit.

## Decisions

- Keep strict JSON-RPC envelope validation unchanged; only payload-specific
  token-usage readers become additive-field tolerant.
- Do not add an upgrade-specific schema service or network test. The reader's
  consumed-field contract is version-agnostic for additive upstream evolution.

## Verification

- Commands to run: focused Assistant Engine Vitest files, Assistant Engine
  typecheck, diff checks, required PR review gates, and exact-head CI.
- Expected outcomes: current-shape events normalize deterministically, malformed
  known fields remain rejected, downstream usage is non-null, and all checks pass.
