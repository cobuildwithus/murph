# Composio connected apps integration

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Implement the Composio connected-apps integration from the ReviewGPT plan as a small, maintainable Murph-owned tool surface.
- Enable hosted Murph to connect user app accounts, search available Composio tools, and execute selected read-oriented connected-app actions through Composio without leaking secrets or building a provider-specific framework.

## Success criteria

- Murph exposes a constant-size connected-app tool surface rather than per-provider Gmail/Calendar tool sprawl.
- Connection and callback UX remain Murph-owned, while Composio owns vendor auth, token refresh, schemas, execution, and vendor result payloads.
- Multiple accounts for the same toolkit can be represented explicitly; ambiguous account selection fails rather than guessing.
- The Composio API key and connected-app content do not enter prompts, diagnostics, operational logs, or committed artifacts.
- Focused tests cover the new contracts, including auth/callback/account routing and tool execution policy.
- Required typecheck/tests, completion audits, PR, and ReviewGPT PR loop pass before handoff.

## Scope

- In scope:
  - Hosted connected-app primitives needed for Composio session/search/execute.
  - Minimal web callback and account-management surfaces required by the plan.
  - Configuration/env validation and tests for the new trust boundary.
  - Durable docs only if the implementation introduces a durable architecture or operator contract.
- Out of scope:
  - Generic connector framework beyond Composio.
  - Per-provider Gmail/Calendar model tools for v1.
  - Webhooks/triggers, background sync, mailbox ingestion, write approvals, custom Google OAuth, and local-runtime support unless required by the returned patch and accepted as necessary.

## Constraints

- Technical constraints:
  - Prefer direct Composio SDK/API calls behind one narrow boundary; do not add defensive middleware or brittle adapter layers.
  - Preserve existing workspace package dependency direction and public-entrypoint rules.
  - Classify any new persisted state explicitly and keep user-facing/queryable truth out of assistant runtime state.
  - Treat supplied ReviewGPT patches as behavioral intent, not overwrite authority.
- Product/process constraints:
  - Use the isolated `codex/composio-connected-apps` worktree and leave the dirty main checkout untouched.
  - Keep legal names, local usernames, home paths, secrets, and credentials out of generated files, commits, docs, logs, and PR text.
  - Run the required completion workflow, open a PR, and complete the ReviewGPT PR loop before calling this shipped.

## Risks and mitigations

1. Risk: Overbuilding a connector abstraction around a service that already supplies tool routing.
   Mitigation: Keep the Murph surface constant-size and delete/avoid provider-specific duplication unless tests prove the simpler design cannot work.
2. Risk: Composio or Google credentials leak through prompts, logs, diagnostics, or committed test fixtures.
   Mitigation: Use config names/placeholders only, redact external errors, and add focused privacy/security tests around the new boundary.
3. Risk: Multi-account routing silently picks the wrong Gmail or Calendar account.
   Mitigation: Require explicit account selection when more than one account can match; test ambiguous selection failures.
4. Risk: The returned patch is stale or mismatched to the current repo.
   Mitigation: Inspect and port the patch manually in the isolated worktree, preserving current architecture and tests.

## Tasks

1. Wait for and inspect the ReviewGPT patch attachment.
2. Apply or port only the scoped, architecture-compatible parts into the isolated worktree.
3. Cut back unnecessary abstractions, middleware, or defensive wrappers before verification.
4. Add or adjust focused tests for the Composio connected-app contracts.
5. Run required verification, audits, commit, PR, and ReviewGPT PR loop.

## Decisions

- Use one isolated worktree/branch from `origin/main`.
- Keep the target architecture small: Murph owns stable connected-app tool contracts; Composio owns auth, schemas, routing, and execution.

## Verification

- Commands to run:
  - Focused tests for touched packages/apps.
  - `pnpm test:diff <changed paths>` when truthful, otherwise owner-level package/app tests.
  - Typecheck for touched owners or workspace as required by the verification router.
  - Required completion audits and ReviewGPT PR loop.
- Expected outcomes:
  - All required checks pass, or any unrelated pre-existing failure is named with evidence.
  - Audit findings are fixed or explicitly rejected with reasons.
Completed: 2026-06-22
