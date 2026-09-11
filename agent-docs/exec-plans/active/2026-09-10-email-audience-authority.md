# Use authorized hosted email routes for audience scope

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal and scope

Personal hosted email replies use the authorized member route for private audience scope even when incoming headers contain additional recipients. Signed group routes remain group-scoped. Remove hosted header inference; retain the local email connector classifier and existing current verified-recipient egress checks.

## Cause and design

Worker ingress counts To/Cc/Bcc recipients after Web has already authorized a personal or group route. A personal alias with Cc becomes non-direct and cannot auto-reply. Runtime import repeats that guess when metadata is missing. Derive the existing boolean at ingress; import the explicit fact, preserving unknown for legacy missing metadata and forcing signed group targets non-direct. Routing authority never authenticates the sender or grants mutation permission.

## Success criteria and product journeys

- Personal signed alias with extra To/Cc/Bcc is private; sender-style authority stays false.
- Signed group alias stays non-direct, redacted, and grant-gated.
- Missing/null scope stays unknown; legacy false stays false; no header inference.
- Direct egress still sends only to current verified owner, clears Cc, and fails closed when verification disappears.
- Focused real-Codex email reply queues one useful response with no additional effects.

## Tasks

1. Add deterministic regressions and remove hosted-only inference.
2. Replay focused ingress/import/egress and real-Codex journeys; update security owner and changelog.
3. Inspect full diff, typecheck, complexity guard, scoped final commit, draft PR, exact-head CI and ReviewGPT.

## Constraints

No new state, RPC, dependency, audience abstraction, or migration. Do not change saved cron route recovery or generic IMAP inference. No production sends or data access. Both new/old ingress and runtime combinations use the existing optional boolean contract.

## Verification

Pending implementation and focused proof.
