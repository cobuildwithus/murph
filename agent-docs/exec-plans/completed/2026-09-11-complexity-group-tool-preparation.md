# Simplify group tool preparation boundaries

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal and protected invariant

Reduce the complexity of group tool execution while preserving every accepted
request, rejection, provider call, notice, capture identity, usage record, and
model-visible result. This is an internal refactor with no intended UX change.

## Owner and evidence

`dynamic-tools.ts` owns model-to-host request preparation. `executeGroupTool`
currently mixes generated-image preflight/capture and current-sender notice
coordination with unrelated group actions and final RPC result handling. Its
baseline cyclomatic complexity is 167. The existing preparation and authorization
owners remain authoritative; there is no new persistent state or API.

## Scope and decisions

Extract typed private preparation helpers for generated avatar/contact-card
requests and current-sender asks. Each helper returns either the existing terminal
result or the prepared request plus the metadata required by final dispatch.
Consolidate duplicated referral participant selection only if its exact authority
and error behavior remain explicit. Keep every preparation call before the existing
RPC try/catch and preserve notice-before-request ordering and usage propagation.
No prompt, schema, provider policy, retry, storage, or deployment contract changes.

## Risks and proof

The main risks are widened authorization, lost usage/error metadata, duplicate
notices, and moving exceptions across the existing catch boundary. Review the
moved statements and run group tool/current-sender/dynamic failure tests plus
relevant typecheck and the complexity guard. Reuse the focused production-derived
live current-sender/avatar journeys after deterministic proof, reviewing exact
effects and reply truth. Existing extensive tests are the primary behavior proof.

## Tasks

1. Extract the two preparation workflows and inspect the full diff.
2. Run focused tests, typecheck, and complexity measurement.
3. Run focused live evidence if applicable; report unavailable evidence honestly.
4. Commit and open a draft PR; parent owns candidate review and final ReviewGPT.

## Verification

- Completed the three private preparation helpers; the final RPC catch, usage
  metadata, capture identities, and shared notice promise remain at their owners.
- Focused group-tool, current-sender, dynamic-failure-boundary, and dynamic-runtime
  suites: 4 files, 156 tests passed, including six referral rejection cases.
- `MURPH_TSC_PACKAGE_MODE=single-threaded pnpm --dir packages/assistant-engine typecheck`: passed.
- `pnpm complexity:diff --base 91d301576fd7ca076e65ba09591f0fda4ae91d91 -- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`: passed;
  group execution 167 to 111, file debt 534 to 484. The new avatar helper is 26;
  further splitting would scatter its cohesive preflight/capture workflow.
- `pnpm test:assistant:live -- --test 'delivers one explicit current-sender consultation privately without a group notice' --codex-home <SUBSCRIPTION_HOME>`:
  passed using gpt-5.6-terra through local subscription. One exact private
  current-sender host request, no group notice, final action none. Ready: quiet
  group output correctly preserves the private consultation. Default and two
  earlier alternate homes failed before any provider action; the next allowed
  alternate succeeded. No authentication content was inspected.
- Full diff and privacy review passed. Parent inspected the candidate source
  without findings. No product, deployment, or provider-input contract changed.
- Implementation complete; parent owns final draft admission, exact-head CI,
  and the user-requested ReviewGPT gate. No live artifacts are committed.
Completed: 2026-09-11
