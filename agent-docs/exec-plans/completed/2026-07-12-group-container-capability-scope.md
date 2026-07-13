# Group Container Capability Scope

## Goal

Make group-chat runtime scope explicit to Murph and ensure personal-account
settings, authorization links, and billing operations are never presented or
executed as group controls.

## Success Criteria

- Every group turn receives an authoritative group-container instruction
  derived from the existing conversation audience; no new persisted state is
  introduced.
- Personal voice/style settings, wearable connection, connected-account
  authorization, Family billing, and personal reminder behavior are omitted or
  redirected appropriately in group turns.
- Group-native management, newsletter, sharing, and explicitly room-scoped
  automation remain available.
- Family billing rejects synthetic thread-container ownership at the web-owned
  effect boundary even if assistant capability gating regresses.
- Focused tests prove direct-versus-group prompt content, tool availability,
  and the protected billing boundary.

## Constraints

- Reuse `effectiveThreadIsDirect` as the single source of truth for turn scope.
- Prefer conditional assembly and existing owner checks over a new policy
  service, persisted flag, compatibility layer, or broad tool rewrite.
- Preserve accountless connected-app utility only when it can be separated
  from personal account authority without weakening the boundary.
- Preserve group-native actions and existing private direct-chat behavior.

## Planned Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant/codex-turn/planning.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- Focused `packages/assistant-engine/test/**` coverage
- `apps/web/src/lib/hosted-execution/family-plan-tool.ts`
- Focused `apps/web/test/**` Family boundary coverage
- Durable product or architecture docs only if the final behavior changes a
  documented contract

## Verification

- Truthful `pnpm test:diff` coverage for the final touched package/app paths
- Direct assembled-prompt and tool-catalog scenarios for direct and group turns
- Required prompt, security/privacy, and coverage completion audits
- Parent final diff/call-path review
- PR ReviewGPT loop to zero accepted findings and green PR CI

## Outcome

- Turn planning now derives one `direct | group` conversation scope from the
  existing audience and includes it in the thread contract.
- Group prompts omit personal style/tone/onboarding, generated personal CLI
  commands, wearable links, Family operations, browser/phone handoffs, and
  connected-account management while preserving group-owned flows and
  accountless services.
- Web-owned Family, device-connect, and connected-app effect boundaries reject
  synthetic group containers independently of prompt/tool gating.
- Direct-chat behavior remains unchanged; focused tests cover prompt content,
  eligible tool catalogs, allowed accountless execution, rejected personal
  operations, and pre-side-effect ordering.

## Completion Evidence

- `pnpm test:diff` passed across affected package/app typechecks, 4,922 affected
  package tests plus the affected web and Cloudflare verification suites.
- `pnpm docs:drift` and `git diff --check` passed.
- Prompt review reached zero findings after two accepted prompt/tool-description
  conflicts were fixed and rerun.
- Security/privacy review reported zero medium-or-higher findings.
- Coverage-write added two narrow negative proofs and reported no remaining
  actionable coverage gaps.

Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
