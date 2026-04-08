Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

This prompt is for Batch 3 and should run only after the billing-ref cutover is reviewed and integrated.

You own the hard cleanup and privacy-retention lane.

Constraints:

- Preserve unrelated dirty-tree edits.
- Do not remove anything that still has a live runtime reader or writer.
- `HostedSession` may be dropped only if you prove there are no runtime readers or writers left. If proof is incomplete, keep it and document the gap.
- Keep cleanup changes privacy-motivated and operationally defensible; do not invent retention numbers without grounding them in existing code or docs.

Goals:

- Drop the legacy identity, routing, and billing-reference fields from `HostedMember` once all readers are migrated.
- Drop durable `telegramUsername`.
- Tighten privacy-retention cleanup where the live repo already has operational residue worth shrinking, such as terminal outbox rows and short-lived webhook receipts.
- Remove `HostedSession` only if direct proof is complete.

Primary files:

- `apps/web/prisma/schema.prisma`
- new cleanup migration(s) under `apps/web/prisma/migrations/**`
- hosted onboarding cleanup or retention helpers under `apps/web/src/lib/**`
- focused tests/docs proving the cleanup is safe

Acceptance:

- The wide `HostedMember` row is reduced to entitlement plus timestamps.
- Dead durable fields are gone.
- `HostedSession` removal happens only with direct proof; otherwise it stays explicitly deferred.
