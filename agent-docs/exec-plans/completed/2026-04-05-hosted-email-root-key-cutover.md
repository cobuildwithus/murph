# Hosted Email Root-Key Cutover

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Move hosted raw email body storage fully onto the bound user's root key once
  `userId` is known, without changing hosted email routing semantics.

## Success criteria

- Raw hosted email bodies are written, read, and deleted through the per-user
  root-key path.
- Hosted email ingress authorization reads the bound user's hosted user env once
  `route.userId` is known instead of relying on a platform-key content path.
- Focused Cloudflare tests cover the user-root-key storage and cleanup path.
- Required verification and the completion-workflow audit pass succeed.

## Scope

- In scope:
- `apps/cloudflare/src/{hosted-email.ts,index.ts,runner-outbound.ts,user-runner.ts,user-env.ts}`
- Focused `apps/cloudflare/test/**` coverage for raw-body storage and cleanup.
- Out of scope:
- Hosted email routing redesign.
- Env-var renames.
- Any user-unlock, passkey, OIDC, Vault/OpenBao, or TEE behavior.

## Constraints

- Technical constraints:
- Treat this as a hard cutover. Do not preserve legacy raw-body paths or
  compatibility shims once the bound user is known.
- Preserve separate platform-key metadata records where the repo already uses
  them for routing or other non-user-content state.
- Product/process constraints:
- Preserve unrelated dirty-tree edits in the shared live worktree.
- Keep the coordination ledger current and use the repo completion workflow.

## Risks and mitigations

1. Risk: deleting with the platform bundle key leaves raw email bodies behind on
   the live user-root-key path.
   Mitigation: route cleanup through the same per-user crypto context used for
   read/write and add a regression test that proves the object disappears.

2. Risk: narrow storage changes accidentally disturb platform-key metadata
   records used for alias routing.
   Mitigation: keep routing records on the existing platform-key path and limit
   edits to raw-body content and bound-user env reads.

## Tasks

1. Update the hosted email raw-body lifecycle to use the bound user's root-key
   context for write, read, and delete.
2. Keep ingress authorization on the user-env read path once `route.userId` is
   known and remove any remaining platform-key content dependency in that lane.
3. Add focused Cloudflare regressions for raw-body cleanup and the user-root-key
   storage invariant.
4. Run required verification and the mandatory completion-review audit pass.

## Decisions

- Keep hosted email route metadata on the existing platform-key path; only raw
  email body content moves fully to the per-user root-key path in this lane.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused `pnpm --dir apps/cloudflare test -- --run <pattern>` while iterating
  if needed.
- Expected outcomes:
- The Cloudflare hosted-email tests prove raw-body storage/cleanup happens on
  the bound user-root-key path and the repo baseline stays green.
Completed: 2026-04-05
