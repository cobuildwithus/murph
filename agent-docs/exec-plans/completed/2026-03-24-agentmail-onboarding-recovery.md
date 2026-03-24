# AgentMail onboarding recovery

Status: completed
Created: 2026-03-24
Updated: 2026-03-24

## Goal

- Let Healthy Bob reuse an existing AgentMail inbox during direct email connector setup and interactive onboarding when the API key can access inbox discovery but cannot create new inboxes.

## Success criteria

- `packages/cli/src/agentmail-runtime.ts` supports `listInboxes` and `getInbox` with preserved HTTP method/path/status context on failures.
- `packages/cli/src/inbox-services.ts` recovers from `createInbox` HTTP 403 by discovering accessible inboxes, auto-reusing the single match, and surfacing actionable multi-inbox or scoped-key guidance.
- Interactive onboarding can reuse a discovered inbox, prompt for a selection when several inboxes are available, and allow manual inbox-id entry when discovery is blocked.
- Help text, docs, and focused tests reflect the reuse-or-provision behavior.

## Scope

- In scope:
  - AgentMail runtime discovery endpoints
  - direct `inbox source add email` recovery/error handling
  - interactive onboarding email inbox discovery/selection/manual entry
  - focused CLI/setup/docs updates and tests
- Out of scope:
  - live AgentMail integration tests
  - non-email channel onboarding changes
  - changing stored connector/runtime schemas beyond narrowly needed recovery metadata

## Constraints

- Keep secrets and real inbox identifiers out of fixtures, logs, and docs.
- Preserve existing email connector ids and current result shapes unless a small additive extension is required.
- Keep direct-thread-only email auto-reply semantics unchanged.

## Risks and mitigations

1. Risk: AgentMail discovery responses differ slightly from current assumptions.
   Mitigation: follow the current official docs and pin behavior with mocked runtime tests.
2. Risk: onboarding prompts become inconsistent with the existing wizard/setup flow.
   Mitigation: keep wizard selection unchanged and localize inbox-selection prompts to the email setup path.
3. Risk: recovery logic masks real permission or account mismatches.
   Mitigation: only recover on explicit create-forbidden cases and surface actionable errors for multi-inbox or discovery-forbidden paths.

## Tasks

1. Add AgentMail inbox discovery client methods and richer HTTP error context.
2. Rework email source add to reuse/discover inboxes on create-forbidden failures.
3. Thread inbox selection/manual-entry support through setup/onboarding email configuration.
4. Update CLI/help/docs wording to describe reuse-or-provision behavior.
5. Add focused tests and run the required verification plus completion audits.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/cli/test/inbox-cli.test.ts packages/cli/test/setup-channels.test.ts packages/cli/test/setup-cli.test.ts --no-coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
Completed: 2026-03-24
