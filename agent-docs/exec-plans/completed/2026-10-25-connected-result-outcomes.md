# Attribute connected-app response limits without changing outcomes

Status: completed
Created: 2026-10-25
Updated: 2026-10-25

## Goal and Product UX

Outcome: distinguish the size boundary and whether an allowed calendar/email write was attempted in existing Web failure diagnostics.
Reaches: operators investigating connected-app oversized responses. Existing assistant write-reconciliation guidance already prevents blind retries and remains unchanged.
Proof: synthetic service-to-JSON/log regressions for provider-wire and compacted-result limits, all fixed writes, read/non-write and preflight paths; exact response and call-count preservation; composed assistant output remains unchanged.

Product UX: internal telemetry only. A candidate service-copy change was rejected after composed base tests proved that the assistant already replaces that copy with correct ambiguity guidance. No member-facing behavior claim or changelog entry is warranted.

## Scope and constraints

Use existing result limits, policy table, error mapping and safe diagnostic pipeline. No new state, egress, retries, auth authority, or provider contract changes. Do not infer a production write from an unclassified oversized-response error. No live provider mutations or private production evidence in this plan or review packet.

## Tasks

1. Prove the mechanism with synthetic failures at the real service boundary.
2. Have ReviewGPT implement the smallest correction and bounded existing-pipeline attribution.
3. Inspect the patch; run focused deterministic tests and typechecks. No live-model journey is required if the composed assistant output and production prompt/tool contracts remain unchanged.
4. Update the durable diagnostic owner, record the internal-only changelog decision, perform parent review, commit and push a scoped PR.
5. Run final ReviewGPT concurrently with required exact-head CI; merge and deploy only when green.
6. Verify the deployed revision and affected outcomes; use native heartbeat observation if available, otherwise preserve the concrete access blocker and unexercised paths.

## Risks

- Oversized provider success is not sufficient evidence of a completed external effect. Preserve uncertainty; never fabricate a receipt.
- Error attribution must use finite host-owned labels, not provider content, tool arguments or identifiers.
- Existing read, preflight, approval, account ownership and byte limits remain authoritative.

## Verification

The telemetry-only regressions fail on base in 14 cases because attribution is absent; all four preflight cases already pass. After the ReviewGPT implementation, 140 focused Web tests and 22 assistant boundary tests pass on Node 24.22.1. Web and Assistant Engine typechecks pass. Complexity, documentation drift, log privacy guard, and diff whitespace checks pass.

Coverage includes both byte ceilings for all four fixed writes, search and ordinary execution, account rename, failures before execution, exact original JSON text, original cause shapes, exact provider-call sequences, finite log details, and exclusion of synthetic private content. The composed assistant continues to preserve ambiguous write outcomes and forbid blind retries. No prompt, tool schema, response text, success path, retry, database call, or provider call changes.

Parent review: the existing fixed-write wrapper supplies truthful post-egress wire attribution; returned results establish the compacted-result boundary. The JSON mapper removes only the newly introduced diagnostics from this error response, preserving its existing public body. No new event or success-path log is added. The existing complexity hotspot remains 27; decomposing unrelated admission and execution policy would add scope without improving this change.

ReviewGPT implemented and then revised the candidate after parent composed-path proof ruled out the initial member-facing hypothesis. The implementation packet contains synthetic evidence only. Final ReviewGPT round 1 returned PASS on ed331dc2aede4a07b4c4e7331d2c9f734fe25f31 with verified GPT-6 Pro on the Mountain lane, attached guarded snapshot, exact-turn capture, and enforced minimum response time. The reviewer independently traced the sole route, JSON mapper, error causes and composed assistant output. Parent final review accepts that evidence and finds no additional correction. Required exact-head CI, canonical deployment, and post-deployment observation remain external completion gates; automation memory owns their live status.
Completed: 2026-10-25
