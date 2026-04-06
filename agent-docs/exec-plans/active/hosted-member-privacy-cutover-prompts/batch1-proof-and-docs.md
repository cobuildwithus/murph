Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

You are implementing the proof-and-docs lane for Batch 1 of the hosted-member privacy cutover on the current live repo.

This lane is intentionally narrow. Your job is to make the migration safer by proving or documenting the assumptions that later cleanup depends on.

Constraints:

- Preserve unrelated dirty-tree edits.
- Prefer docs, proof notes, and narrowly scoped tests over runtime refactors.
- Do not redesign the schema in this lane.
- Do not remove `HostedSession`.
- Do not add email identity fields to Postgres.
- If a claimed assumption is not fully proven from the live tree, mark it as `UNCONFIRMED` rather than guessing.
- Return a concise handoff with proof found, gaps left open, and any focused verification run.

Goals:

- Write a concise architecture/proof note for the four-lane split:
  - entitlement on `HostedMember`
  - identity on `HostedMemberIdentity`
  - routing on `HostedMemberRouting`
  - billing refs on `HostedMemberBillingRef`
- Record direct proof for these seams from the live repo:
  - verified email stays in hosted execution user env / Cloudflare route state rather than a Postgres account field
  - Revnet is environment-gated and should not make wallet mandatory when disabled
  - `HostedSession` runtime usage is still unproven and must remain proof-required before removal
- Add narrow docs or test coverage only where it materially locks those assumptions in place.

Suggested files:

- a concise note under `agent-docs/exec-plans/active/` or `docs/`
- `ARCHITECTURE.md` only if a short durable clarification is warranted
- focused tests under `apps/web/test/**` if you can add proof without colliding with the implementation lane

Acceptance:

- The proof note makes explicit what is locked versus still proof-required.
- The note reflects the actual live repo, not just the migration wish list.
- Email remains documented as out-of-Postgres state.
