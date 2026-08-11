# Group Health Newsletter

Last verified: 2026-08-10
Status: Implemented

## Product

A member of a hosted Murph group can ask for a recurring health newsletter in
the current iMessage, SMS, or Telegram room, or as one shared group email. The
newsletter celebrates wins and finds the most interesting recent pattern in a
group-chosen tone. Setup asks only for missing choices: name, schedule,
delivery, exact shared projections, and optional tone or note.

The newsletter is a skill recipe, not a runtime subsystem:

```text
group-newsletter skill
        -> ordinary group-scoped automation
        -> ordinary murph.group read_shared
        -> current group outbox OR generic authorized group-email effect
```

The skill owns setup and editorial behavior. The automation runtime owns the
schedule and occurrence. Web-owned group sharing supplies facts. Generic group
email authority owns recipients and delivery. No other runtime owner needs to
recognize a newsletter.

## Locked Product Decisions

| Decision | Choice |
| --- | --- |
| Setup and edits | Any current group member may request them. One stable `group-health-newsletter` automation per group; later requests edit that recipe. |
| Delivery | One normal current-chat response or one shared reply-all email to eligible members. Never both for one occurrence. |
| Default schedule | Sunday morning in the group vault timezone unless the group chooses another cron schedule. When a member names a timezone, preserve the requested wall clock and persist its IANA `timeZone`. |
| Tone | Supportive by default. Roast only after explicit group opt-in and within group-chat safety limits. |
| Email permission | `group-email.v0` means “share my email with this group.” It is reusable and not newsletter-specific. |
| Health permission | Every fact requires the matching active group projection grant. Email permission alone grants no health data. |
| First edition | Setup announces the recipe. The first edition uses the next natural cron occurrence; setup never creates an immediate one-shot send. |
| Missing verified email | Preparation reports only an aggregate count. The group may receive one non-shaming setup/status message with the Settings link; there is no private newsletter mailbox wake. |
| Opt-out | A current authenticated participant may revoke only their own `group-email.v0` grant. Existing health shares remain unchanged. |
| Access gating | Group newsletter setup and delivery use the ordinary hosted-group access rules. |

## Ordinary Automation Recipe

The canonical state is one ordinary cron automation in the synthetic group
runtime's vault. The `group-newsletter` skill saves it with
`murph.automation action="save"`:

```text
slug: group-health-newsletter
title: <group-chosen newsletter name>
schedule: <chosen cron expression, with explicit IANA timeZone when requested>
continuityPolicy: fresh
instructions:
  Open and follow the group-newsletter skill before doing anything else.
  Newsletter recipe:
  - Delivery: current_chat | group_email
  - Newsletter name: <exact name>
  - Tone: supportive | roast
  - Projection scopes: <exact scope keys>
  - Custom note: <text or none>
```

The slug is product metadata for one-recipe lookup and editing. It grants no
capability and changes no execution behavior. The skill uses ordinary
automation show, save, and patch operations. There are no reserved newsletter
tags, structured newsletter compiler, delivery-mode parser, first-send cron
constant, or runtime-injected newsletter instructions.

Instructions must not persist recipients, email addresses, group or route ids,
shared facts, grant snapshots, or authorization claims. Skills carry behavior;
the automation record carries the group-visible recipe; neither carries
authority.

## Current-Chat Execution

At a scheduled current-chat occurrence:

1. The automation reopens the `group-newsletter` skill.
2. The model calls `murph.group action="read_shared"` once with the exact saved
   projection scopes.
3. It composes only from the returned current consent-aware facts.
4. The normal scheduled response and conversation outbox deliver one update to
   the automation's already-bound group route.

Cron does not inspect the slug, tags, or instructions for newsletter meaning.
It uses the same durable occurrence claims, route authority, retry rules, and
delivery settlement as any other group automation. A scheduled Telegram group
route must still be resolved to the exact current synthetic container before
shared reads and revalidated before provider entry.

## Generic Group-Email Execution

Email remains a two-phase effect because composition needs authorized facts
before the body exists, while irreversible delivery must revalidate recipients
and grants after composition.

The model-facing surface is part of `murph.group`:

```ts
const prepared = await murph.group({
  action: "read_shared",
  projectionScopes,
  audience: "group_email",
});

await murph.group({
  action: "send_email",
  subject,
  html,
  text,
});
```

`read_shared audience="group_email"` is available only to an exact scheduled
non-direct group automation occurrence. Trusted runtime code prepares current
recipient authority through the ordinary group control port, performs the
ordinary shared-data read, and filters the result to members who are eligible
for this email. The model receives only authorized facts plus aggregate
`recipientCount`, `missingVerifiedEmailCount`, and `referenceAt`. It receives no
email addresses, share ids, authorization proof, recipient ids for sending, or
group/route selector.

The preparation is invocation-local, single-use, and bound to the exact
automation id and occurrence. `send_email` accepts only subject, HTML, and
optional equivalent text. It cannot supply or alter recipients. A send closes
the capability and is terminal for the assistant turn so the normal group
conversation outbox cannot also publish the edition.

The generic host-facing preparation action is intentionally narrower than the
model-facing shared read. It returns only an address-free participant/grant
snapshot and proof to trusted runtime code; the existing group shared-data
primitive remains the sole fact reader.

## Authority and Privacy

Email authorization is derived at preparation and revalidated immediately
before durable fanout acceptance:

```text
eligible recipient
  = current group participant
  ∩ active hosted access
  ∩ active health consent
  ∩ active group-email.v0 grant
  ∩ active exact requested projection grants
  ∩ verified email identity
```

Web derives the group from the signed synthetic runtime member. The model
cannot supply a group id. The proof binds the exact group, participants,
verified-email identities, projection scope keys, and share ids. A changed
membership, consent, grant, scope, or verified identity invalidates the proof
before fanout. Recipient addresses are resolved Web-side and appear only in
outbound headers, never in the group vault or model result.

One shared MIME lists the authorized audience in `To`, while the transport uses
one envelope recipient per child intent. That makes reply-all behavior and
address visibility explicit consequences of `group-email.v0`. Email `From`
identity is not authenticated participant authority, so replies may converse
and read group context but cannot mutate automations, group settings, consent,
or self-opt-out state.

## Durability and Idempotency

The accepted email body is one parent intent in the existing assistant outbox.
Its occurrence-scoped key is derived from:

```text
automationId + occurrenceAt + effectKind(group_email) + groupId
```

Repeated execution discovers the same parent instead of composing or accepting
another edition. The parent carries the existing immutable automation
revision/occurrence authority and the address-free proof. Web revalidates the
proof and durably creates generic member-scoped child intents before marking
the parent sent. Each child uses the existing retry and terminal lifecycle.

Cron records an accepted parent in its ordinary pending-delivery field and
settles the occurrence from the parent state without another model turn. A
restart between parent acceptance and the cron write recovers that same parent
from the occurrence key. New writes use only the generic `group-email-effect:`
key and generic authorization-proof field. Current readers also recognize the
legacy `group-newsletter:` key and proof field solely to drain parents accepted
before the cutover; a later write normalizes the proof to its generic name.

Preparation or send unavailability before parent acceptance keeps the normal
automation occurrence retryable. A send result of `accepted` means durable
acceptance, not provider delivery. Partial recipient outcomes remain durable;
successful children are never replayed because a sibling failed.

## Editorial Contract

The private `group-newsletter` skill owns the newsletter's story, completed-day
comparison rules, units, subject, HTML/text equivalence, and tone. Its core
content rules are:

- compare usable completed local dates only; exclude the open current day;
- declare a cross-person winner only when compared date sets are identical;
- never treat an unobserved day as zero or invent a sync/permission cause;
- use human units and keep broad movement separate from workout duration;
- never turn a completed-day average into a weekly total;
- find one recognizable group story instead of dumping every returned field;
- avoid lowest-performer, missing-data, body, diagnosis, and illness jokes;
- use only the current tool result, never private one-to-one data or raw share
  files.

Current-chat editions are concise group messages. Email editions use one
subject, HTML body, and equivalent text body, then call `send_email` at most
once and produce no duplicate chat edition.

## Removed Newsletter Runtime Surface

The runtime no longer has:

- `murph.automation action="save_newsletter"` or a newsletter config compiler;
- reserved newsletter delivery tags or slug recognition in cron;
- an injected newsletter execution prompt or forced chat/email delivery mode;
- a top-level newsletter model tool;
- a dedicated Cloudflare newsletter port or Web newsletter route;
- newsletter-named outbox settlement or authorization services;
- a newsletter-specific missing-email mailbox kind, importer, wake, or nudge;
- newsletter-only one-shot GitHub workflows.

The reusable parts remain under generic owners: `group-email.v0`, Web recipient
authorization and revalidation, shared group reads, the assistant outbox,
provider fanout, cron occurrence durability, and route authority.

## Verification

Focused coverage must prove:

- ordinary newsletter save/patch recipes and no reserved runtime metadata;
- current-chat runs need no email preparation and use normal group delivery;
- email preparation filters model-visible facts to eligible recipients;
- send is single-use, recipient-free, terminal for the turn, and
  occurrence-idempotent;
- membership, consent, exact grant, verified-email, and proof changes fail
  closed before fanout;
- accepted parent recovery and generic child retry settlement do not recompose;
- legacy accepted keys and persisted proof fields remain read-only while new
  outbox and wire writes use only generic group-email names;
- retired runner-to-Worker and Worker-to-Web proof aliases fail closed rather
  than silently losing recipient revalidation;
- no newsletter-specific tool, port, route, mailbox, cron branch, outbox type,
  authorization service, or capability flag remains in runtime code.

## Deployment Concerns

This is a hard cutover, not a mixed-version execution contract. A pre-cutover
runner may execute only the old skill-authored recipe shape. It must never
claim a recipe created or edited by the new skill: an untagged new
`current_chat` recipe would be misclassified as email by that runner.

Before deploying either new producer, suspend all hosted automation wake
dispatch and wait for in-flight newsletter turns to finish. Do not publish the
private skill while an old runner or Worker remains addressable. With wakes
still suspended, deploy the matching Vercel/Web receiver, then deploy the
Cloudflare Worker and runner bundle with immediate container rollout and prove
the exact runner-bundle fingerprint. Treat that public runtime as the hard
rollback floor. Only then publish the private skill bundle and resume automation
wakes. If any step before the floor fails, roll back the still-old producer
pair. After the skill is published, recover only with a forward fix at or above
the floor; never restore a pre-cutover runner or the old private skill.

This gate prevents both current-chat and group-email recipes from being
created, edited, or claimed across the version boundary. It also means new
durable and wire writes need no legacy aliases. Current code retains only the
readers required to finish old automation instructions, already-accepted
outbox parents, and retired mailbox rows. Remove those readers after every old
recipe has been rewritten through an interactive edit, all legacy-prefix
parents and children have drained, and the retired mailbox inventory is empty.

After rollout, prove one current-chat occurrence and one group-email
prepare/send occurrence. Confirm the model receives no addresses or grant
metadata, a grant or verified-email change after preparation blocks fanout,
the accepted parent becomes the cron occurrence's ordinary pending-delivery
intent, and the occurrence settles without a second model turn. Do not roll the
runner or private skill independently to a revision that expects the removed
surface.

## Future Options

- A listserv-style group alias could hide member addresses if the product later
  chooses that privacy model.
- A group-scoped Web configuration surface could promote the recipe from
  automation instructions only if a current product need justifies a second UI
  owner.
- Catch-up delivery after a member verifies an email remains out of scope; the
  next natural occurrence includes them automatically.
