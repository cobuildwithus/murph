# Compact the deferred automation schema

Status: active
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Cut the deferred `murph.automation` model-facing schema to roughly half its current serialized size while preserving the canonical runtime validator, action set, defaults, authority, and observable automation behavior.

## Success criteria

- The full existing automation schema remains the sole runtime validation and diagnostic authority.
- The deferred descriptor derives a compact inline model schema from that canonical object; no second handwritten action/property owner exists.
- Every canonical action, root property, and per-action allowed/required root field remains discoverable in the model schema, with no residual local `$ref`; differing action-local value shapes remain scoped to their owning action.
- Unsupported canonical schema structure fails visibly by returning the full schema, so the size-budget regression fails rather than silently dropping capability.
- Serialized model-facing schema size is no more than 55% of the canonical schema and the measured provider-input delta is recorded.
- Focused behavior, compatibility, token-budget, typecheck, preliminary specialist, final ReviewGPT, and exact-head CI gates pass before merge.

## Scope

- In scope: one dependency-free schema derivation helper at the existing automation descriptor boundary, the descriptor wiring, compatibility/budget tests, and any required architecture/deployment documentation.
- Out of scope: changing canonical automation parsing or writes, action semantics, schedules, routes, occurrence ownership, executor behavior, provider transport, adding dependencies, or splitting automation into new tools.

## Constraints

- Technical constraints: derive from the exact canonical runtime schema object; keep transport inline; preserve deferred discovery terms; use the full schema as the only safe fallback; add no registry, generator, manager, framework, or transport fork.
- Product/process constraints: Product UX classification is an internal Patch with no changed member promise or journey. Review A remains an independent recommendation check before landing. Apply ReviewGPT artifacts only after parent path/hunk inspection.

## Risks and mitigations

1. Risk: a compact advertisement hides a valid action or required field.
   Mitigation: executable parity tests enumerate canonical actions, root properties, and per-action required roots; unsupported structure falls back to full schema.
2. Risk: broader model-side value validation or action-mis-scoped prose increases malformed tool calls.
   Mitigation: retain useful property types and nested value guidance, advertise strict per-action allowed/required roots plus differing action-local value shapes, keep top-level field prose in the tool description, keep canonical runtime parsing fail-closed, and add representative valid/invalid advertisement regressions.
3. Risk: a second compact schema drifts from runtime truth.
   Mitigation: forbid handwritten duplication and derive only from the canonical schema object.
4. Risk: the changed dynamic-tool descriptor rotates existing native provider threads once at deployment and bounded replay can omit older context or begin with an orphaned assistant answer.
   Mitigation: keep the existing fingerprint and fallback owners, retain coherent member/assistant replay boundaries when a prefix is omitted, instruct the first fresh turn to inspect authoritative state or clarify instead of guessing unavailable intent, and prove the exact full-schema-to-compact-schema replay plus following-turn resume path.

## Tasks

1. [x] Capture current schema bytes/tokens and identify repeated union content.
2. [x] Ask a dedicated implementation ReviewGPT for a scoped attachment-based patch from review B's recommendation.
3. [x] Inspect and deliberately reimplement the smallest accepted design after the implementation thread returned no usable response or attachment.
4. [x] Reconcile review A's independent result and reject any recommendation that adds a second schema owner or depends on unproven `$ref` expansion across deferred discovery consumers.
5. [x] Run focused automation behavior, schema parity, token-budget, and typecheck proof.
6. [x] Commit/push the candidate, open the PR, and start preliminary specialist and final ReviewGPT gates concurrently with CI.
7. [ ] Resolve findings, merge the approved exact head, and retire the worktree.

## Decisions

- Prefer inline flattening over `$defs`/`$ref` because deferred search/index consumers may not expand references consistently.
- Preserve full runtime validation; compaction belongs only at the model descriptor boundary.
- Use a detectable full-schema fallback rather than emitting an incomplete compact contract.
- Review A's native Zod `$ref` proposal was rejected after current OpenAI tool-search guidance confirmed schema injection but did not establish reference expansion for every hosted-search, App Server, and code-mode discovery consumer.

## Verification

- Commands to run: focused assistant-engine automation/schema Vitest suites, `pnpm --dir packages/assistant-engine typecheck`, exact serialized bytes and target-model token measurement, required ReviewGPT gates, and required GitHub Actions.
- Expected outcomes: unchanged runtime behavior and canonical validation, complete compact discovery metadata, model schema at or below 55% of canonical size, and a green exact pushed PR head.
- Preliminary specialist remediation: the compact contract now rejects cross-action root fields, retains action-local value refinements when variants differ, and does not globalize action-specific field descriptions. Bounded fresh-thread replay now begins on a retained member boundary when ordinary exchanges survive and its incomplete-history marker directs the first reply to inspect or clarify rather than infer missing intent.
- Parent Product UX re-review after remediation: Ready. The first rollout turn receives a coherent retained exchange suffix, explicit notice that older intent may be unavailable, and a direct inspect-or-clarify rule; it cannot silently treat an orphaned answer or missing message as the member's current intent. The following turn's native resume remains proven.
- Current local result: 119 focused tests passed and the assistant-engine typecheck passed. The canonical/model schemas measure 15,353/8,427 minified UTF-8 bytes and 4,533/2,565 o200k tokens, for byte/token ratios of 54.89%/56.59%.
- Replacing only the automation descriptor schema in the identical captured first-request fixture measures 31,007/24,081 bytes and 7,739/5,771 o200k tokens for an individual turn (-6,926 bytes, -22.34%; -1,968 tokens, -25.43%). The group fixture remains unchanged at 27,033 bytes/6,072 tokens because that route does not advertise automation.
