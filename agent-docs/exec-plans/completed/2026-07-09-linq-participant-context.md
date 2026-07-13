# Contextual Linq Participant Changes

Status: completed
Updated: 2026-07-09

## Why

Linq already subscribes to participant-added and participant-removed events,
but hosted web does not yet accept those event types or make them useful to a
group runtime. Murph should notice group roster changes without turning each
provider webhook into an automated message or building a second scheduler.

## Success criteria

- Accept, sanitize, and deduplicate Linq `participant.added` and
  `participant.removed` events through the existing provider-event ledger.
- Resolve only an existing Linq thread route; participant events never create a
  hosted member, thread container, group, membership, or sharing grant.
- Reconcile the existing thread-container participant projection from the
  provider's current roster without introducing another job or state owner.
- Coalesce additions into bounded context for the next accepted organic group
  message. A quiet room stays quiet: no participant-event wake, debounce timer,
  queue, cron, or Temporal workflow.
- Let the normal group turn read one decision-grade roster and optionally use
  the existing `post_join_offer`; never send one offer per webhook, and never
  combine the hosted-group offer with the new-room contact-card path.
- Treat removals as roster truth only. Do not infer whether somebody left or
  was removed, revoke hosted membership/shares, or generate a standalone joke.
- Preserve route authority, webhook idempotency, contact privacy, foreground
  reply priority, and iMessage deliverability guardrails.
- Land the scoped change on an isolated branch, pass required verification and
  local specialist audits, open a PR, and complete the PR ReviewGPT loop with no
  unresolved accepted findings.

## Design constraints

- Reuse the existing `HostedLinqProviderEvent`, `HostedThreadRoute`, participant
  reconciliation, `read_chat_participants`, and `post_join_offer` owners.
- Keep exact provider facts in web-owned Postgres; do not put queryable product
  truth in assistant runtime state.
- Carry only the minimum context needed by the next ordinary group turn. Do not
  add a new mailbox kind or assistant execution path unless current contracts
  prove the ordinary message path cannot carry the hint safely.
- Prefer one server-derived membership predicate over model-side identity or
  handle matching.
- Keep all new persisted schema additive and backward compatible during a web
  deploy; document any real deploy-order requirement instead of adding shims.

## Resolved design

- Use one `HostedThreadRoute.pendingParticipantAddition` boolean. Unique
  additions set it; the next accepted non-direct routed message atomically
  clears it immediately before the mailbox append. PostgreSQL row-update
  serialization makes a separate token, counter, or timestamp unnecessary.
- Coalescing is message-bound rather than wall-clock-bound: participant events
  never speak or wake Murph, and all additions before the next accepted group
  message produce one roster-check opportunity.
- The coalescer intentionally retains no added-person identity. The later turn
  can make only a generic room-wide decision from the live roster; it cannot
  attribute the opportunity to, name, or target a specific new participant.
- Carry one optional typed `groupParticipantAdded` field on the existing Linq
  conversation payload. The runtime projects it as trusted source metadata and
  the prompt renders a separate `Group context` section without altering the
  human's canonical message text.
- `read_chat_participants` derives `isHostedGroupMember` from the hosted-group
  membership owner rather than the live transport-participant projection.
- The Cloudflare group-tool port requests that additive roster field through a
  versioned query capability. Web omits it for older runners, while the new
  parser treats omission as unknown, preserving a quiet staggered deploy.
- Removal humor is intentionally excluded because the provider status is
  optional and is not reliable enough to drive a standalone joke. Organic
  conversation can still be funny when humans supply the context.

## Expected working set

- `apps/web/prisma/schema.prisma` and one additive migration if bounded route
  state is required
- `apps/web/src/lib/hosted-onboarding/linq-provider-events.ts`
- `apps/web/src/lib/hosted-onboarding/linq-provider-event-store.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-groups/group-tool.ts`
- hosted execution/runtime contracts only where the existing message or group
  tool payload needs one optional field
- `packages/assistant-engine/skills/group-chat/SKILL.md`
- focused hosted web, hosted execution/runtime, and assistant skill tests
- the smallest durable architecture/product doc update required by the final
  boundary

## Verification

- Focused Vitest coverage for provider parsing/store, webhook routing and
  coalescing, group roster membership, and prompt/skill behavior.
- `pnpm test:diff <touched paths>` when it truthfully covers all owners.
- `pnpm typecheck` and `git diff --check`.
- Direct scenario proof that several additions before one accepted group
  message create one context opportunity, while removals and quiet rooms send
  nothing.
- Required `security-privacy-review` and `coverage-write` local audit passes.
- Parent final diff/call-path review, clean PR-head preflight, green PR CI, and
  ReviewGPT rounds through a valid zero-accepted-findings `REVIEW_COMPLETE`.

## Progress

- Isolated worktree and task branch created from current `origin/main`.
- Provider ingestion, route coalescing, normal-message context, live roster
  membership, prompt policy, local subscription, migration, and focused tests
  implemented.
- The route flag uses an expand-safe nullable column with a `false` default;
  only exact `true` is pending. This preserves the binary runtime behavior
  without weakening the production migration guard or adding a backfill and
  contract migration.
- Focused owner tests, Prisma generate/validate, root typecheck, package
  boundary checks, scenario-integrity coverage, the complete Cloudflare
  verifier, and the complete web verifier pass. The web verifier covered 4,034
  tests, lint, dev smoke, TypeScript, and the production Next.js build.
- The serial acceptance run passed all package coverage lanes except the
  assistant-runtime coverage lane, where unrelated scheduler-sensitive
  workspace-entrypoint tests missed polling phases under instrumentation. The
  same file passes 192/192 with its normal scheduler, and the complete runtime
  package passes 1,482 tests without coverage. Assistant CLI coverage passed on
  an isolated rerun with the same thresholds.
- Security/privacy, coverage, simplicity, migration-safety, and parent
  call-path reviews report no accepted findings after the expand-safe migration
  correction.
- Scoped commit/PR, PR-head preflight, green CI, and ReviewGPT remain.
Completed: 2026-07-09
