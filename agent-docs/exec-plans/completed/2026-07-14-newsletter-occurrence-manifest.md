# Newsletter occurrence manifest

## Goal

Fix the group newsletter retry path so one scheduled occurrence cannot produce
multiple shared email payloads under the same delivery identity.

Success criteria:

- The first durable parent intent owns the occurrence payload after any provider
  entry may have happened.
- Proven pre-provider recipient retries reuse that parent payload instead of a
  fresh model-composed body.
- Authorization proof binds the exact verified-email lookup identity, not just
  email presence.
- Shared newsletter MIME construction has one stable Date seed for all
  recipient envelopes.
- Focused tests cover mixed-payload retry prevention, authorization-change
  terminal progress, verified-email identity changes, and byte-identical MIME.

## Constraints

- Keep the fix scoped to the returned review finding.
- Preserve current authority checks before every provider entry.
- Do not persist raw recipient email addresses in assistant runtime state or the
  group vault.
- Avoid a new queue, scheduler, or broad state machine; reuse the existing parent
  and child outbox intents.
- Do not expose secrets, raw mailbox/email content, private identifiers, local
  usernames, or home paths in committed artifacts.

## Approach

1. Inspect newsletter parent/child outbox reconciliation, hosted fanout, web
   authorization proof, and Cloudflare MIME construction.
2. Patch the minimal owners so the occurrence key selects one immutable parent
   manifest and recipient retries copy from it.
3. Bind the proof to the existing web-owned verified-email lookup identity and
   add a parent-owned MIME Date seed.
4. Add focused regression tests for the returned review paths.
5. Run scoped verification and required completion audits.

## State

Active.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
