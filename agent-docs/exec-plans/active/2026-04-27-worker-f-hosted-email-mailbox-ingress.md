# Worker F Hosted Email Mailbox Ingress

## Goal

Replace the deleted web hosted-run email ingress callback with a narrow
mailbox-based ingress callback and point the Cloudflare email worker at it.

Success criteria:

- Cloudflare appends a canonical `conversation.message` email mailbox item
  through web before nudging the runner.
- The web callback lives outside `/api/internal/hosted-run`.
- The callback uses existing signed Cloudflare auth and
  `appendHostedMailboxEnvelopeTx`.
- Cloudflare stays thin: append through web, then nudge/run the runner without
  hosted-run acquire/commit/finalize/peek/adopt behavior.
- Focused tests cover the new route and Cloudflare caller behavior.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Touch only the Worker F ownership set unless a compile blocker requires a
  minimal adjacent test change.
- Do not edit runner transport, assistant-runtime, hosted-execution parsers, or
  old Cloudflare run-drain processor files.
- Do not reintroduce `/hosted-run`, committed sequence targets, event adoption,
  turn-input peek/adopt, or run finalize semantics.
- Logs, docs, tests, and examples must not contain personal identifiers, raw
  provider payloads, secrets, local filesystem paths, or contact details beyond
  synthetic fixture values.

## State

Implementation complete; handoff blocked from full repo completion workflow by
local Codex usage-limit failure on required subagent reruns.

## Done

- Read repo routing docs, `migration.md`, security/reliability/verification
  guidance, and the active hosted-runtime coordination rows.
- Confirmed the old `/api/internal/hosted-run/email-ingress` route is already
  deleted in the working tree.
- Added `/api/internal/hosted-mailbox/email-ingress` signed callback route.
- Updated the Cloudflare email ingress control-plane client to call the mailbox
  route and parse mailbox append responses.
- Added focused web route coverage for mailbox append and oversized callback
  body rejection before signature verification.
- Added/updated focused Cloudflare coverage for the mailbox callback path and
  mailbox append response shape.
- Ran focused web and Cloudflare vitest checks, web typecheck, scoped web lint,
  diff whitespace check, and identifier/secret scan.
- Fixed the first security-review finding by bounding the route body before
  the signed callback verifier reads it.

## Now

Hand off with verification status and the completion-workflow blocker.

## Next

- After Codex usage resets, rerun the required security/privacy, coverage-write,
  and task-finish-review subagents against the current diff.
- Re-run broad Cloudflare typecheck after the active hosted-runtime migration
  test updates land.

## Open Questions

- Broad Cloudflare typecheck is red in unrelated hosted-runtime migration tests
  outside Worker F ownership.
- Full web lint is red in an unrelated homepage JSX escaping issue; scoped lint
  for Worker F web files is green.
- Required completion-review subagents could not complete because the local
  Codex CLI reported a usage-limit error during rerun.

## Working Set

- `apps/web/app/api/internal/hosted-mailbox/email-ingress/route.ts`
- `apps/web/test/hosted-email-mailbox-ingress-route.test.ts`
- `apps/cloudflare/src/web-control-plane-email-ingress.ts`
- `apps/cloudflare/test/hosted-email-worker-ingress.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Verification:
  `pnpm exec vitest run apps/web/test/hosted-email-mailbox-ingress-route.test.ts --config apps/web/vitest.workspace.ts --no-coverage`;
  `pnpm exec vitest run apps/cloudflare/test/hosted-email-worker-ingress.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`;
  `pnpm --dir apps/web typecheck`;
  `pnpm --dir apps/web exec eslint app/api/internal/hosted-mailbox/email-ingress/route.ts test/hosted-email-mailbox-ingress-route.test.ts`;
  `git diff --check -- <Worker F paths>`.
