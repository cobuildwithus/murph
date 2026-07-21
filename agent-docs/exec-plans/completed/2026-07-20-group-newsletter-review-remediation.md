# Group newsletter review remediation

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Close the two accepted ReviewGPT findings on PR #813 without introducing a
  new newsletter, Telegram, or email-delivery owner.
- Make Telegram group setup reachable through the existing thread-container
  route and bind every newsletter email intent to the exact automation
  revision that authorized it.

## Success criteria

- A linked active member's real Telegram group webhook creates or reuses one
  thread-container route and appends the message to that container mailbox
  with authority bound to the exact Telegram thread and container.
- A newly created Telegram group container can answer the admitting message
  even when its activation wake is still being processed.
- A scheduled Telegram group newsletter receives the existing consent-aware
  shared reader, uses the ordinary Telegram outbox, and receives no newsletter
  email capability.
- Telegram consent setup reuses the existing group join URL in the ordinary
  conversation instead of adding reaction-provider machinery.
- Switching an old current-chat newsletter to email starts a fresh opt-out
  window from the new automation revision.
- Newsletter parent, hosted fanout child, and retry child intents all preserve
  the existing automation revision authority.

## Constraints

- Reuse the existing thread-container, group tool, automation, shared-reader,
  and outbox owners.
- Add no table, queue, service, scheduler, provider-specific newsletter path,
  or parallel authority representation.
- Preserve direct Telegram behavior and tagless legacy email compatibility.

## Tasks

1. Route authenticated non-direct Telegram webhooks through the current
   thread-container owner, preserve group directness, and bind the wake to the
   exact existing route authority.
2. Make scheduled shared reads channel-neutral while keeping Linq-only
   permission-offer side effects Linq-only.
3. Reuse the group join-link result for Telegram consent in the ordinary chat
   response and update the durable skill/contract.
4. Anchor email opt-out to `updatedAt` and copy existing automation authority
   through newsletter parent, fanout, and retry intents.
5. Add production-path and revision-fence regressions, re-run required checks,
   and complete ReviewGPT round 2.

## Review findings

- Round 1 High: Telegram group setup was advertised but real non-direct
  Telegram webhook ingress and scheduled shared-read scoping were absent.
- Round 1 High: delivery-mode changes and newsletter outbox fanout omitted the
  existing automation revision fence, allowing a stale email after an edit and
  reusing the original record age for the opt-out window.

## Production-path findings

- The first real Telegram group run exposed a race between the newly created
  container's activation wake and its first conversation wake. Reusing the
  existing inbound-channel self-heal policy for Web-admitted Telegram routes
  makes that first reply independent of wake ordering.
- A non-direct Telegram wake now carries the existing external-thread route
  authority, and both wake construction and message targeting fail closed when
  it is missing or does not match the container and chat.

## Completion evidence

- Real hosted-local Telegram group webhook to thread-container mailbox to
  ordinary Telegram outbox E2E passed.
- `pnpm test:scenario-integrity` passed for 204 scenarios.
- `pnpm test:diff` passed with an 8 GB Node heap and one Vitest worker: all
  affected package/app typechecks, tests, lint, dev smoke, production build,
  package boundaries, and repository guards. The bounded settings avoid the
  local host's default 4 GB Vitest worker ceiling without changing product
  behavior or reducing coverage.
Completed: 2026-07-20
