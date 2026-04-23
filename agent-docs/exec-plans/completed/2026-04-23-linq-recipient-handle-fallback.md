# Preserve LINQ recipient line attribution for sparse canonical payloads

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Preserve LINQ recipient-line attribution when canonical sparse `message.received` payloads omit `recipient_phone` but still identify the recipient line through `recipient_handle` or `chat.owner_handle`.

## Success criteria

- Hosted LINQ webhook routing accepts sparse canonical `message.received` payloads that only expose the recipient line through handle fields and resolves the paired recipient phone from that handle.
- Inboxd normalization uses the canonical recipient line handle as `accountId` when `recipient_phone` is absent instead of falling back to the default/null account id.
- Focused regression tests cover the shared recipient-line fallback plus the hosted control-plane and inboxd consumers.

## Scope

- In scope:
  - `packages/messaging-ingress/src/linq-webhook.ts`
  - `packages/messaging-ingress/test/linq-webhook.test.ts`
  - `apps/web/src/lib/linq/control-plane.ts`
  - `apps/web/test/linq-control-plane.test.ts`
  - `packages/inboxd/src/connectors/linq/normalize.ts`
  - `packages/inboxd/test/linq-connector.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-linq-recipient-handle-fallback.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - Linq raw minimization/schema changes
  - hosted conversation wake adapter cleanup
  - Prisma schema or storage-model changes

## Constraints

- Technical constraints:
  - Keep the shared recipient fallback additive on top of the current LINQ parser shape.
  - Hosted control-plane lookup must still normalize to a real phone number before binding lookup.
- Product/process constraints:
  - Preserve overlapping active LINQ lanes, especially raw minimization and hosted conversation wake cleanup.
  - Avoid widening into `apps/cloudflare/**`, CLI, or local Linq product-surface removal work.

## Risks and mitigations

1. Risk: A generic fallback could treat non-phone opaque handles as hosted recipient phones.
   Mitigation: Keep the shared helper string-based, but re-normalize through the hosted phone parser before any hosted binding lookup.

2. Risk: Inboxd and hosted routing drift again if they each open-code recipient resolution.
   Mitigation: Export one shared recipient-line helper from `@murphai/messaging-ingress/linq-webhook` and reuse it in both consumers.

## Tasks

1. Add a shared LINQ recipient-line helper that falls back from `recipient_phone` to `recipient_handle`/`chat.owner_handle`.
2. Switch hosted LINQ webhook routing to use that helper before recipient-phone normalization and binding lookup.
3. Switch inboxd normalization to use that helper for `accountId` fallback when `recipient_phone` is absent.
4. Add focused regressions in `messaging-ingress`, `apps/web`, and `inboxd`.
5. Run scoped verification plus required completion audits, then finish or hand off with any overlap blocker called out explicitly.

## Decisions

- Reuse one shared recipient-line helper instead of duplicating fallback logic in `apps/web` and `inboxd`.
- Recipient-line precedence is `recipient_phone` -> `recipient_handle.handle` -> `chat.owner_handle.handle`.

## Verification

- Commands run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/test/linq-webhook.test.ts apps/web/src/lib/linq/control-plane.ts apps/web/test/linq-control-plane.test.ts packages/inboxd/src/connectors/linq/normalize.ts packages/inboxd/test/linq-connector.test.ts`
  - `pnpm --dir packages/messaging-ingress exec vitest run test/linq-webhook.test.ts`
  - `pnpm --dir packages/inboxd exec vitest run test/linq-connector.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/linq-control-plane.test.ts`
  - `pnpm exec tsx --eval '...'` direct sparse-payload proof
- Outcomes:
  - `pnpm typecheck` failed for unrelated pre-existing workspace boundary issues plus unrelated `packages/inboxd` test typecheck failures outside this LINQ slice.
  - `pnpm test:diff ...` failed before owner tests due unrelated pre-existing workspace boundary checks and assistant-cli/inbox-services type errors.
  - Focused Vitest proof passed for `packages/messaging-ingress`, `packages/inboxd`, and `apps/web`.
  - Direct sparse-payload proof passed and showed the hosted path resolves `chat.owner_handle` to a phone and inboxd attributes a sparse canonical payload to the recipient-line handle id.
  - Required `coverage-write` audit found the current proof sufficient as-is.
  - Required `task-finish-review` found no high/medium issues; the low precedence-proof gap was closed with explicit `recipient_handle`-wins regressions in `apps/web` and `packages/inboxd`.
