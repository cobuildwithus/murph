# Separate route style and resume planning

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and invariant

Reduce route-turn planning complexity (129) while preserving exact prompt text, sparse personality preferences, voice precedence, contract fingerprints and native resume eligibility. No new tool availability, input data, provider call, state or permission.

## Design

Extract two synchronous calculations into private functions: effective route style preferences and native-resume thread selection. Keep them at the same execution points, with explicit arguments and unchanged expressions. Existing prompt builders, saved-preference owner, resume binding and contract-fingerprint primitives remain canonical. No new import or dependency.

## Verification

Focused route-planning, context-handoff, persona and group-personalization tests; assistant-engine typecheck; exact base/head prompt/resume comparison where supported; complexity and privacy review. A focused live assistant journey supplements deterministic tests. Final ReviewGPT and exact-head CI gate completion. No changelog for an internal behavior-preserving refactor.

## Progress

Implemented both private calculations at the original call sites. Route-plan complexity 129 → 109; file debt 123 → 103. New helpers remain below 20.

113 tests passed across route planning, context handoff, persona prompts and group personalization. Assistant-engine typecheck and complexity guard passed. Existing planning assertions cover assembled provider declarations, sparse style behavior, fingerprint rotation and resume selection. Diff inspection verified unchanged expressions and original evaluation points.

The focused real-Codex voice-precedence journey passed all three scenarios on gpt-5.6-terra through local subscription auth: configured voice, one-off named voice, and saved voice. Each produced exactly one voice attachment and no response text; only the saved-voice scenario issued a preference update, preserving other settings. Ready for the asserted behavior. This supplements the direct planning tests; it does not independently exercise the whole route planner.

Final exact-head CI and ReviewGPT remain pending after publication.
Completed: 2026-09-13
