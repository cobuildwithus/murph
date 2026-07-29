# Add Linq line and chat health preflight

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Preserve Linq's independent line service status, line reputation, and chat
  health instead of collapsing them into one Murph delivery-health field.
- Reuse the existing Web-owned Linq egress authority and provider-dispatch fence
  to block unsafe sends and give scheduled Murph turns a small, typed recovery
  posture.
- Keep established routes sticky while steering new assignments away from
  at-risk lines and preserving ordinary replies to fresh inbound messages.

## Success criteria

- `HostedLinqLine` stores provider service status and provider reputation
  independently while the existing `health_status` column represents only
  Murph-observed delivery health.
- The latest Linq chat-health status is projected by blinded chat key without
  storing message content, participant handles, or another routing authority.
- Webhook projection is the fast path and one bounded paginated reconciliation
  repairs missed or silence-driven provider changes.
- New assignments exclude at-risk lines; existing routes remain valid unless a
  hard block applies.
- Scheduled Linq turns receive only a closed `cautious` or `recover` posture;
  final provider entry rechecks hard blocks through the existing egress fence.
- Focused tests, exact-head CI, required review gates, and deployment checks pass.

## Scope

- Hosted Web Prisma schema and additive migration.
- Linq inventory, webhook parsing, provider-event projection, and chat-health
  reconciliation.
- Existing Linq line-selection and egress-preflight owners.
- Additive Web/Cloudflare/assistant-runtime contracts for scheduled delivery
  posture.
- Focused tests and current iMessage deliverability documentation.

## Constraints

- No Murph-built reputation score, new dispatcher, new queue, second provider
  fence, model-facing health tool, or provider-authored prompt text.
- No synchronous Linq network request while a route or dispatch transaction is
  open.
- No raw chat ids, participant handles, or message contents in the new
  chat-health projection.
- Preserve existing first-contact authority, route ownership, replay safety,
  usage authorization, foreground priority, and current-inbound reply behavior.
- Keep the existing internal egress URL during the compatibility window.

## Evidence

- Legacy inventory parsing stored `reputation.status` in generic
  `providerStatus`.
- Legacy provider status handling merged `new_status` and `new_reputation` by
  severity before projecting one `healthStatus`.
- Delivery receipts mutated the same `healthStatus`, so provider reputation and
  Murph delivery evidence could overwrite one another.
- Scheduled Linq turns already resolve route authority before model work and
  reassert it at provider entry before the existing dispatch claim.

## Tasks

1. [x] Add independent provider line fields and the latest chat-health
   projection through an expand migration.
2. [x] Replace severity merging with narrow provider-status parsers and
   independent provider projections while retaining legacy columns during the
   compatibility window.
3. [x] Add webhook chat-health projection and bounded global chat
   reconciliation.
4. [x] Update line selection and implement one pure final-target egress policy.
5. [x] Propagate typed scheduled-delivery posture through existing runtime
   contracts and dynamic context.
6. [x] Add focused parsing, projection, routing, race, and compatibility tests.
7. [x] Correct durable deliverability guidance and document rollout/deployment.
8. [ ] Run focused proof, review gates, exact-head CI, reconcile current `main`,
   and close the migration.

## Verification log

- The implementation patch was applied atomically to PR #1118 at commit
  `a87010da4d1d5e86d268295e2220e8324ba70688`; temporary patch/export workflow
  files were removed in the same commit and the ordinary repository hygiene
  workflow was restored from `main`.
- `git diff --check` passed on the prepared implementation patch.
- Every changed TypeScript file passed syntax transpilation with TypeScript 5.9
  before publication.
- Focused Web tests passed 350/350, assistant-engine tests passed 159/159, and
  the provider-entry regression passed with no Linq message send after a final
  hard block.
- Web, assistant-engine, assistant-runtime, and hosted-execution typechecks
  passed. Prisma Client generation and `prisma validate` also passed.
- Product-experience review returned no findings. It confirmed that the
  scheduled-warning and hard-block flow is the smallest complete user
  experience; full rendered model-output and one live/staging end-to-end run
  remain post-deploy evidence gaps.
- Exact-head CI, preliminary/final ReviewGPT gates, and merge-base
  reconciliation remain pending on the next pushed implementation head.
