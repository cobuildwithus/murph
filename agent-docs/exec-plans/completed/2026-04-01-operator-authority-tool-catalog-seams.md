# Centralize accepted inbound operator authority and split assistant tool composition by concern

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Centralize the internal contract that says an accepted inbound message acts as the operator for the bound vault, and refactor assistant tool-catalog assembly so it is composed by concern instead of by turn-type booleans.
- Preserve current product behavior: accepted messaging turns still have full Murph autonomy, and existing external tool-catalog options remain stable.

## Success criteria

- One shared assistant-core seam resolves operator authority for accepted inbound messages and carries that contract into turn planning instead of leaving it implicit in auto-reply/runtime branching.
- `createDefaultAssistantToolCatalog` assembles tools from concern-oriented internal groups covering assistant runtime, query/read, canonical vault writes, and outward side effects.
- Existing callers keep their current behavior, including full Murph autonomy for accepted messaging turns and current bounded catalog options for inbox routing/tests.
- Focused assistant and tool-catalog tests plus repo typecheck pass.

## Scope

- In scope:
- Assistant auto-reply plumbing and turn planning around accepted inbound message authority.
- Internal assistant tool-catalog composition helpers and the tests that prove the existing public behavior.
- Minimal durable doc updates only if the landed contract becomes architecture-significant.
- Out of scope:
- Changing hosted ingress authorization rules or billing/member checks.
- Reintroducing a new user-facing authority surface or reducing messaging autonomy.
- Broad provider/runtime refactors unrelated to authority normalization or tool-catalog composition.

## Constraints

- Technical constraints:
- Preserve the published `createDefaultAssistantToolCatalog` call shape unless a compatibility shim is kept.
- Do not disturb unrelated dirty-tree work, especially the active hosted-web and package-rename lanes.
- Product/process constraints:
- Messaging turns remain fully autonomous on Murph once the inbound message has been accepted.
- Hosted worker/user scoping and host/control-plane boundaries stay unchanged.

## Risks and mitigations

1. Risk: Internal authority normalization accidentally becomes a behavior change for manual, cron, or gateway-triggered turns.
   Mitigation: Keep the new contract additive, default non-message turns to direct operator authority, and prove accepted messaging turns explicitly in assistant tests.
2. Risk: Concern-based tool grouping accidentally drops or reclassifies tools behind existing public booleans.
   Mitigation: Keep the external options stable, route them through the new concern composer, and extend focused catalog assertions for side-effect and write concerns.

## Tasks

1. Add a shared assistant-core operator-authority contract for accepted inbound messages and thread it from auto-reply decision into turn planning.
2. Refactor assistant tool-catalog assembly into internal concern groups while preserving the current public options and catalog behavior.
3. Add or update focused tests for authority propagation and concern-based catalog behavior.
4. Run focused verification, complete the required audit review, and finish with a scoped commit.

## Decisions

- Keep the “accepted inbound message acts as operator” contract inside assistant-core rather than adding a separate hosted-only dispatch authority layer.
- Treat concern splitting as an internal composition refactor; existing public catalog options stay available for now and map onto the new internal grouping.

## Verification

- Commands to run:
- `pnpm typecheck`
- Focused `packages/cli/test/assistant-service.test.ts` cases covering conversation policy and accepted messaging turns
- Focused `packages/cli/test/inbox-model-harness.test.ts` cases covering tool-catalog inclusion/exclusion
- Any additional focused assistant-runtime/hosted-runtime tests needed by the final diff
- Expected outcomes:
- All focused tests and repo typecheck pass, and the final audit confirms the change stayed behavior-preserving apart from the intended internal seam cleanup.
Completed: 2026-04-01
