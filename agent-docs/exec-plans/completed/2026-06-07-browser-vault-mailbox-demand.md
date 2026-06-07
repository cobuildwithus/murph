# Browser vault mailbox demand fallback

Status: completed
Created: 2026-06-07
Updated: 2026-06-07

## Goal

- Stop giving mailbox-backed `runtime.browser-vault-refresh-requested` work a special web/Temporal demand reason now that assistant-runtime owns interpreting that mailbox item.

## Success criteria

- `runtime.browser-vault-refresh-requested` pending system mailbox work falls through to generic `{ reason: "nudge", source: "mailbox_backlog" }` demand.
- Legacy direct `browserVaultRefreshRequested` demand still returns `{ reason: "browser_vault_refresh", source: "browser_vault_refresh" }`.
- Focused web demand tests cover the changed behavior.
- Required verification and completion audits pass or blockers are documented.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-orchestration/runtime-demand.ts`
  - `apps/web/test/hosted-orchestration-demand.test.ts`
- Out of scope:
  - Temporal workflow changes.
  - Cloudflare runner changes.
  - Assistant-runtime PR2 behavior.
  - Removing legacy direct `browser_vault_refresh_requested` compatibility.

## Constraints

- Preserve foreground/runtime ownership model: web owns durable facts and demand projection, local runtime owns browser-vault mailbox behavior.
- Do not add state, schedulers, helpers, or new cross-service contracts.
- Preserve unrelated working-tree edits.

## Risks and mitigations

1. Risk: Removing the mapping before PR2 runtime is deployed could make mailbox-backed explicit refresh behave as a generic wake only.
   Mitigation: Document deployment order in handoff.
2. Risk: Accidentally removing legacy direct browser-vault demand compatibility.
   Mitigation: Keep `input.browserVaultRefreshRequested` branch untouched and verify tests.

## Tasks

1. Remove browser-vault system-mailbox special case from web demand selection.
2. Update web demand tests to expect generic system mailbox backlog for browser-vault control items.
3. Done: Run focused and required verification.
4. Skipped: Required completion audits were intentionally stopped per user instruction to publish quickly.
5. Next: Commit through `scripts/finish-task`.

## Decisions

- Keep legacy direct `browserVaultRefreshRequested` demand semantics as compatibility.

## Verification

- Commands to run:
  - `pnpm --dir apps/web test -- hosted-orchestration-demand.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff apps/web/src/lib/hosted-orchestration/runtime-demand.ts apps/web/test/hosted-orchestration-demand.test.ts`
- Expected outcomes:
  - Passed.
Completed: 2026-06-07
