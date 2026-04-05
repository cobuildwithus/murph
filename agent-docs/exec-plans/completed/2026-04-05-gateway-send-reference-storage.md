# Gateway Send Reference Storage

## Goal

Stop storing `gateway.message.send` inline in `execution_outbox.payload_json` and move it onto the existing reference-storage pattern so session/message plaintext no longer lands in the hosted web outbox row.

## Scope

- Change the shared hosted-execution outbox payload policy for `gateway.message.send`.
- Update any shared/app-local dispatch-ref or hydration logic only if the current live path needs it.
- Treat this as greenfield-only; do not add a legacy inline gateway-send compatibility lane.
- Update focused tests that cover payload storage policy, parity, and any gateway-send hydration path.

## Constraints

- Treat this as a high-risk hosted privacy/storage change.
- Preserve unrelated dirty-tree edits already present in hosted web/cloudflare/package files.
- Follow the existing inbound-email/telegram/linq reference-storage pattern rather than inventing a new payload format.
- Do not add a Prisma migration unless the current reference design proves it is strictly required.

## Verification

- Focused hosted-execution/web/cloudflare tests for the touched outbox payload and hydration paths.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- In progress
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
