# Simplify assistant tool boundaries

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Delete duplicate assistant tool-availability and App Server approval-policy
  checks while preserving the exact existing tool, authority, and request
  behavior at their canonical boundaries.

## Success criteria

- Exact offered-tool admission remains the sole tool-availability gate before
  execution; maintenance, accepted-input, vault, and hosted-port authority
  checks remain unchanged.
- `executeCodexAppServerTurn` remains the sole approval-policy normalization and
  validation boundary; prepared requests carry the normalized `never` policy.
- Focused deterministic tests prove offered/unoffered tool behavior and direct
  approval-policy rejection plus start/resume request shapes.
- A focused synthetic real-Codex journey proves an offered tool still executes
  once with the correct user-visible result and no internal boundary language.
- Package typecheck, exact-head CI, sequential preliminary/final ReviewGPT, and
  parent final review complete with no unresolved accepted finding.

## Scope

- In scope: Assistant Engine dynamic-tool admission/execution plumbing, App
  Server request construction, focused deterministic/live journey proof.
- Out of scope: tool catalog policy, tool descriptions, maintenance/user-action
  authority, provider behavior, new abstractions, deployment, and merge.

## Constraints

- Technical constraints: preserve exact externally observable behavior and
  existing canonical authority checks; add no compatibility layer or state.
- Product/process constraints: private-free synthetic proof only; sanctioned
  worktree; draft PR; ReviewGPT lane `hercules`, preliminary then final
  sequentially; do not merge.

## Risks and mitigations

1. Risk: deleting the wrong check exposes an unoffered or unauthorized tool.
   Mitigation: retain and directly test exact offered-key admission plus every
   independent maintenance/user-action/vault/host-port check.
2. Risk: approval-policy validation moves too late or request builders emit an
   unsupported value.
   Mitigation: keep validation before process preparation in the central entry
   point and type the prepared request policy as the normalized literal.

## Tasks

1. Trace exact production callers and focused existing tests.
2. Delete duplicate availability and approval-policy plumbing.
3. Update deterministic tests and add one focused live journey.
4. Run focused tests, package typecheck, and the live journey; inspect effects.
5. Commit, push, open draft PR, run preliminary then final ReviewGPT with CI,
   resolve permitted findings, close the plan, and report without merging.

## Decisions

- Product UX classification: internal behavior-preserving architecture cleanup;
  no product-owned dimension changes. Coverage lens applies; prompt/frontend
  lenses do not.
- Changelog: not applicable because member-visible behavior, copy, action count,
  recovery, delivery, and tool availability are intentionally unchanged.

## Verification

- Commands to run: focused Assistant Engine Vitest slices, Assistant Engine
  typecheck, `pnpm test:assistant:live -- --test <focused-pattern>`, exact-head
  CI, preliminary and final ReviewGPT.
- Expected outcomes: deterministic checks green; one offered tool effect and
  truthful reply in the live journey; no unoffered tool execution; unsupported
  approval policy rejected centrally; normalized `never` emitted for start and
  resume; no unresolved accepted review finding.
Completed: 2026-08-28
