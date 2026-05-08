# Deepsec Medium Hardening

## Goal

Resolve the selected Deepsec medium findings without adding avoidable complexity:

- Browser-vault session request body cap and low-friction abuse throttling.
- Hosted Stripe webhook bounded raw-body read before signature verification.
- Hosted Telegram webhook bounded raw-body read before secret/body processing.
- Hosted runner Dockerfile base/native artifact pinning or checksum verification.

## Scope

- `apps/web` hosted browser-vault and webhook request handling.
- Existing shared HTTP/body helpers where they can remove duplication.
- `Dockerfile.cloudflare-hosted-runner-base` and any existing deploy docs/tests that must stay aligned.

## Constraints

- Ignore connected-source consent findings for this task.
- Keep changes simple, composable, and long-term maintainable.
- Prefer existing helpers and route patterns over new infrastructure.
- Do not introduce new dependencies unless unavoidable.
- Do not print or commit secrets, local account identifiers, home paths, or raw request payloads.
- Preserve unrelated dirty worktree edits.

## Verification

- Focused hosted-web tests for body caps/session abuse controls.
- Focused Dockerfile/static guard if an existing guard covers runner supply-chain shape.
- `pnpm test:diff` for touched files when truthful; otherwise app/package scoped checks from the verification policy.
- Required security/privacy and completion audits because this touches public ingress, health-data adjacent session access, and hosted runner supply chain.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
