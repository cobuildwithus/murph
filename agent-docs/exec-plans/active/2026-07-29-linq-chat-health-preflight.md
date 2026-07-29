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

- Current inventory parsing stores `reputation.status` in generic
  `providerStatus`.
- Current provider status handling merges `new_status` and `new_reputation` by
  severity before projecting one `healthStatus`.
- Delivery receipts mutate the same `healthStatus`, so provider reputation and
  Murph delivery evidence overwrite one another.
- Scheduled Linq turns already resolve route authority before model work and
  reassert it at provider entry before the existing dispatch claim.

## Tasks

1. [ ] Add independent provider line fields and the latest chat-health
   projection through an expand migration.
2. [ ] Replace severity merging with narrow provider-status parsers and dual
   writes during the compatibility window.
3. [ ] Add webhook chat-health projection and bounded global chat
   reconciliation.
4. [ ] Update line selection and implement one pure final-target egress policy.
5. [ ] Propagate typed scheduled-delivery posture through existing runtime
   contracts and dynamic context.
6. [ ] Add focused parsing, projection, routing, race, and compatibility tests.
7. [ ] Correct durable deliverability guidance and document rollout/deployment.
8. [ ] Run focused proof, review gates, exact-head CI, and close the migration.

## Verification log

- Pending implementation.
