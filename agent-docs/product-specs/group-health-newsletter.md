# Group health newsletter

## Product goal

A group can ask Murph for a recurring health newsletter in the current chat or by email. Newsletter behavior is a skill-driven recipe over existing group primitives, not a standalone runtime subsystem.

## User experience

Murph asks only for missing choices: name, schedule, delivery, shared scopes, tone, and an optional editorial note. It then saves one ordinary group-scoped automation.

- Chat delivery uses the normal scheduled assistant response.
- Email delivery uses the normal automation plus the generic scheduled group-email capability.
- Editing, pausing, and stopping use ordinary automation patch/archive behavior.

## Setup contract

The `group-newsletter` skill calls `murph.automation action="save"` with:

- a stable slug, normally `group-health-newsletter`
- `continuityPolicy="fresh"`
- a normal schedule
- complete instructions that say to read the skill on every run and record the selected scopes, tone, delivery, and custom note
- no special delivery field for chat, or `delivery="current_conversation"`
- `delivery="group_email"` only after the group explicitly chooses email

The parser strips `delivery` before persistence. For group email it adds the reserved `system:automation-delivery:group-email` tag. Model-supplied `system:` tags remain invalid, so instructions, slugs, and user tags cannot forge delivery authority.

`save_newsletter` remains only as a migration adapter for older callers. New setup must not use it. Remove that adapter after production inventory shows no legacy caller and all stored records use the generic delivery tag or ordinary chat path.

## Execution contract

### Current chat

The scheduled turn receives the saved instructions unchanged. The skill calls `murph.group action="read_shared"` once for the exact configured scopes, composes one concise update, and returns the normal send-message decision. Cron, routing, and the conversation outbox do not know that the automation is a newsletter.

### Group email

The reserved delivery tag grants one occurrence-scoped group-email capability. The runtime appends only the generic email safety contract:

1. prepare one current authorization snapshot
2. compose from only those authorized facts
3. send once
4. return a skip decision because the email outbox owns delivery and retry

The existing authority boundary remains mandatory: active group binding, membership, health consent, `group-email.v0`, verified email identity, exact projection grants, revocation revalidation, same-occurrence preparation, and durable idempotency.

## Invariants

- Newsletter instructions never confer recipients, consent, routes, member identity, or data authority.
- Current-chat editions never require email consent or the email tool.
- Group-email delivery is parser-owned and cannot be forged with model-authored tags.
- Data is read only from currently authorized shared projections.
- External email effects are one-shot, occurrence-scoped, durable, and retry-safe.
- A missing email address is not announced with a named or shaming message.
- Existing stored email newsletters continue to run during migration.

## Architecture

Newsletter-specific behavior belongs in `packages/assistant-engine/skills/group-newsletter/SKILL.md`. The only retained runtime special case is the reusable authorized group-email effect. Legacy newsletter tags and the old structured save action are compatibility-only and have an explicit deletion condition.

## Success criteria

- New current-chat newsletters are ordinary automations with no newsletter runtime branch.
- New email newsletters are ordinary automations with one generic group-email tag.
- The skill owns setup and editorial policy.
- Model-authored `system:` tags remain rejected.
- Existing newsletters continue to deliver safely during migration.
