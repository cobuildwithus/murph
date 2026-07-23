# Quantified group usage in murph.group read_usage

Status: active
Created: 2026-07-23

## Goal

- Let a hosted group ask Murph "what's our usage at / how much is left" and get
  a truthful quantified answer: the `murph.group` `read_usage` action reports a
  rounded percent of the current period's usage remaining alongside the existing
  coarse capacity state, period end, and funding link.
- Keep exact currency accounting hidden. No dollar amounts, credit balances,
  contributor identity, or purchase history are exposed (consistent with the
  2026-07-23 hide-usage-credit-balance decision, which kept percentages
  user-facing while removing exact balances).

## Success criteria

- `read_usage` returns a new `remainingPercent` integer (0-100, clamped,
  floor-rounded) derived from the same gate decision that already produces
  `capacityState`; no raw `UsdMicros` value crosses the payload boundary.
- The hosted-execution parser accepts the new field as optional (old web
  payloads without it still parse) and continues to reject accounting fields.
- The `murph.group` tool description tells the model it may share the percent
  remaining and period end, and must still never infer or disclose internal
  currency accounting, contributor identity, or payment status.
- Focused tests cover: percent derivation (healthy/low/exhausted, clamp >100%
  credit-extended remaining, zero/invalid limit), parser acceptance of payloads
  with and without the field, and continued rejection of accounting keys.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-groups/group-usage-capacity.ts` and
    `group-usage-funding.ts` (compute percent next to capacity state).
  - `packages/hosted-execution/src/runtime-control.ts` payload type and
    `packages/hosted-execution/src/parsers/runtime-control.ts` allowlist.
  - `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
    `read_usage` description.
  - Matching focused tests in `apps/web/test/hosted-group-tool.test.ts`,
    `packages/hosted-execution/test/parsers.test.ts`, and any assistant-engine
    tool-description proof.
  - `agent-docs/product-specs/hosted-usage-topups.md` /
    `hosted-plan-usage.md` group-visibility wording if they assert coarse-only.
- Out of scope:
  - Usage accounting, settlement, checkout, refunds, admission gating.
  - Personal/family Settings presentation (unchanged by design).
  - The group funding web page.

## Constraints

- Web remains the sole usage projection owner; the percent is computed
  server-side in the web handler, never in the runner.
- Parser must stay fail-closed on unknown keys; the new key is an explicit
  optional addition, not a relaxation.
- Deploy skew: the parser (Cloudflare runner bundle) must accept the field
  before web starts sending it, so the field is optional in the parser and the
  safe deploy order is Cloudflare first, then web.

## Risks and mitigations

1. Risk: remaining can exceed the period limit when purchased credit extends
   capacity, producing a percent over 100.
   Mitigation: clamp to 0-100 and test that case explicitly.
2. Risk: parser rejection during deploy skew breaks read_usage entirely.
   Mitigation: optional field in parser plus Cloudflare-first deploy order
   documented in the PR's deployment section.

## Tasks

1. Compute the clamped percent in the web group-usage status path and include
   it in the handler payload.
2. Extend the hosted-execution payload type and parser (optional field).
3. Update the `read_usage` tool description.
4. Add/extend focused tests for all three owners; align product-spec wording.
5. Run `pnpm test:diff` over the touched owners, complete required audits, then
   finish-task commit and open the PR.
