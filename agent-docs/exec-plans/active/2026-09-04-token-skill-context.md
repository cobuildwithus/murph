# Reduce task-specific skill context while preserving assistant behavior

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Reduce irrelevant lazy-loaded policy during behavior support and experiment turns while preserving every existing domain rule and canonical effect.

## Success criteria

- Original policy retained verbatim across entrypoints and references.
- Shared safety, grounding, privacy, consent, ordinary setup, active-session logging, and stop gates remain in entrypoints before dependent actions.
- Focused policy assertions, reference packaging, typecheck, and production-derived real journeys pass.
- Ordinary behavior setup and active-experiment entrypoints load less policy; support and full setup still read all applicable rules.

## Scope

- In scope: behavior-followthrough and experiment-onboarding workflow references, test fixtures, discovery and behavior proof.
- Out of scope: model changes, tool authority/availability, billing/runtime state, provider transport, and sibling PRs.

## Constraints

- Move source policy instead of rewriting domain rules for brevity.
- Reuse recursive skill packaging and filesystem reads; no runtime loader or eager injection.
- Preserve registry metadata, tool definitions, and first-request assembly.

## Product UX

- Effort: Patch.
- Outcome: Same grounded setup, exact support reconciliation, and canonical session logging with less irrelevant policy context.
- Reaches: Private behavior launch/reuse, support-only repair, and repeated-set completion; clinical, consent, and group privacy gates remain in policy.
- Proof: Preserve all prior owner assertions and run those three production-derived real-Codex journeys; verify ambiguity and private/group non-write boundaries deterministically and with existing focused journeys as needed.

## Risks and mitigations

1. Missed policy before a write: explicit action routing, common gates, complete live-fixture materialization, and exact effect assertions.
2. Lost policy or packaging: line conservation, local-link checks, and existing semantic assertions against the complete owner policy.
3. Increased read overhead: measure entrypoints and workflow reads; no mandatory recursive loading.

## Tasks

1. Inventory source and callers, move workflow detail verbatim.
2. Preserve semantic assertions, fix fixture materialization, and add routing proof.
3. Run deterministic tests/typecheck, then focused real journeys and review replies/effects.
4. Review full diff/privacy and measurements, close plan, commit, open PR.
5. Parent review, readiness, required CI, and routed final review.

## Decisions

- Limit to the two largest multi-workflow entrypoints; keep eager-tool discovery unchanged.
- Retain ordinary behavior Setup workflow and Active experiment support in the entrypoint. Initial live exploration did not reliably demonstrate loading every separated policy reference; smaller entrypoint savings are preferable to moving these common safeguards.
- Repair references remain mandatory before support effects; one real support reconciliation has demonstrated entrypoint then complete reference then inventory then exact reconcile, with truthful timing uncertainty.
- Existing repeated-set fixtures omitted production CLI bootstrap guidance and allowed shell-source inspection. Restore the production manifest contract for direct fixtures before treating them as policy evidence; group private-state exclusions remain unchanged.
- Final live proof uses the repository-pinned Codex 0.151.0 binary, matching shipped runtime.
- No new persistence or authority owner; unavailable policy blocks only dependent actions.

## Verification

- Initial focused policy/asset tests: 61 passed, 7 existing skipped; assistant-engine typecheck, complexity, docs drift, and gardening passed.
- Final layout retains every original nonempty policy line verbatim across owner files. Entrypoints: behavior 50,734 to 25,515 bytes; experiment 58,162 to 27,125 bytes. These are lazy policy bytes, not complete request tokens or measured allowance savings.
- Registry/frontmatter, eager schemas, runtime tools, first-request assembly, and persisted state are unchanged.
- Skill Creator standalone validator could not import PyYAML in this environment; repository frontmatter, asset-link, and semantic assertions provide next-best validation.
- Final layout policy/asset tests passed: 61 passed, 7 existing skipped. Final assistant-engine typecheck and complexity guard pass.
- Pinned real support reconciliation passes: entrypoint then complete support policy, one compact exact-series inventory, one exact reconcile; existing reminder retained and stale review archived, with no invented delivery time.
- Pinned repeated-set logging passes with production CLI guidance: all confirmed occurrences saved under the canonical alternating target, exact totals reread, no setup/support reference loaded unnecessarily.
- Setup proof remains pending. Recovered synthetic native evidence proves the full behavior policy was surfaced, while completed command events lost the initial output chunk and the model discarded yielded command handles. Reuse the existing source-CLI fixture friction report; preserve full native results and reconstruct matching streamed command output in test evidence without changing business policy or relaxing effects.
- Stream reconstruction regression passes, preserving earlier surfaced policy without duplicating final output or mixing command identities. Identifier scan is clean. Final setup journey and final typecheck rerun are in progress; PR and exact-head CI remain pending. Early live failures remain diagnostic evidence only.
