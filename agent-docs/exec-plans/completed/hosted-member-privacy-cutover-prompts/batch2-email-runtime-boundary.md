Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

This prompt is for Batch 2 and should run only after Batch 1 review confirms the identity split direction.

You own the email/runtime-boundary guardrail lane. This is intentionally narrow because the live repo already appears to keep verified email out of Postgres.

Constraints:

- Preserve unrelated dirty-tree edits.
- Prefer tests and docs over runtime redesign.
- Do not add or move email identity into Prisma.
- Do not redesign hosted email routing or Cloudflare sender auth in this lane.

Goals:

- Lock in the rule that verified email stays out of the hosted web Postgres account model.
- Keep the flow as:
  - Privy verified email
  - hosted execution user env
  - Cloudflare verified-sender / route state
- Add focused tests or docs proving that this remains true after the wider member split.

Primary files:

- `apps/web/app/api/settings/email/sync/route.ts`
- `apps/web/src/lib/hosted-execution/control.ts`
- focused tests under `apps/web/test/**`
- docs only if a concise durable note is needed

Acceptance:

- No Prisma email identity field is introduced.
- The tested/documented email flow still terminates in hosted user env and Cloudflare route state.
