# Worker F Hosted Email Mailbox Ingress

## Goal

Replace the deleted web hosted-run email ingress callback with a narrow
mailbox-based ingress callback and point the Cloudflare email worker at it.

Success criteria:

- Cloudflare appends a canonical `conversation.message` email mailbox item
  through web before nudging the runner.
- If the post-append Durable Object nudge fails or is not accepted, Cloudflare
  starts a durable web-side pointer-only nudge workflow keyed by the appended
  mailbox item id.
- Cloudflare does not silently accept append+nudge failure unless the durable
  workflow handoff is accepted.
- The web callback lives outside `/api/internal/hosted-run`.
- The callback uses existing signed Cloudflare auth and
  `appendHostedMailboxEnvelopeTx`.
- Cloudflare stays thin: append through web, then nudge/run the runner without
  hosted-run acquire/commit/finalize/peek/adopt behavior.
- Focused tests cover the new route and Cloudflare caller behavior.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Touch only the Worker F ownership set plus the existing pointer-only webhook
  nudge workflow source enum/step when needed to share Linq/Telegram's retry
  model for email.
- Do not edit runner transport, assistant-runtime, hosted-execution parsers, or
  old Cloudflare run-drain processor files.
- Do not reintroduce `/hosted-run`, committed sequence targets, event adoption,
  turn-input peek/adopt, or run finalize semantics.
- Logs, docs, tests, and examples must not contain personal identifiers, raw
  provider payloads, secrets, local filesystem paths, or contact details beyond
  synthetic fixture values.

## State

Implementation complete and verified. Scoped commit is blocked by overlapping
dirty workflow source/test edits owned by the active device-sync nudge fallback
row.

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
  diff whitespace check, and identifier/secret scan for the original mailbox
  append slice.
- Fixed the first security-review finding by bounding the route body before
  the signed callback verifier reads it.
- Added a signed web callback to start the existing pointer-only nudge workflow
  for email mailbox items after direct Cloudflare Durable Object nudge failure.
- Updated Cloudflare email ingress to require either direct nudge acceptance or
  durable workflow handoff after mailbox append.
- Added focused Cloudflare and hosted-web tests for direct nudge throw,
  unaccepted nudge, workflow-start failure, callback mailbox ownership checks,
  and email workflow source mapping.
- Updated hosted runtime protocol docs and architecture docs for the email
  fallback invariant.
- Security/privacy review, coverage-write pass, and final review completed with
  no findings.

## Now

Archive this plan without a scoped commit because overlapping dirty files make
an exact commit unsafe.

## Next

- Revisit commit once the overlapping device-sync workflow fallback row lands
  or coordinate a combined commit for the shared workflow type/test files.

## Open Questions

- `webhook-workflow-types.ts`, `webhook-workflow-steps.ts`, and
  `hosted-onboarding-webhook-workflows.test.ts` contain overlapping device-sync
  workflow fallback edits. Do not commit the full files as email-only work.

## Working Set

- `apps/web/app/api/internal/hosted-mailbox/email-ingress/route.ts`
- `apps/web/app/api/internal/hosted-mailbox/email-ingress/nudge-workflow/route.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts`
- `apps/web/test/hosted-email-mailbox-ingress-route.test.ts`
- `apps/cloudflare/src/web-control-plane-email-ingress.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/test/hosted-email-worker-ingress.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Verification:
  `pnpm exec vitest run apps/web/test/hosted-email-mailbox-ingress-route.test.ts --config apps/web/vitest.workspace.ts --no-coverage`;
  `pnpm exec vitest run apps/cloudflare/test/hosted-email-worker-ingress.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`;
  `pnpm --dir apps/web typecheck`;
  `pnpm --dir apps/web exec eslint app/api/internal/hosted-mailbox/email-ingress/route.ts test/hosted-email-mailbox-ingress-route.test.ts`;
  `git diff --check -- <Worker F paths>`.
- Final verification:
  `pnpm exec vitest run apps/web/test/hosted-email-mailbox-ingress-route.test.ts apps/web/test/hosted-onboarding-webhook-workflows.test.ts --config apps/web/vitest.workspace.ts --no-coverage` passed;
  `pnpm exec vitest run apps/cloudflare/test/hosted-email-worker-ingress.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage` passed;
  `pnpm --dir apps/cloudflare typecheck` passed;
  focused hosted-web ESLint passed;
  `git diff --check -- <touched slice>` passed;
  `pnpm docs:drift` passed;
  `pnpm --dir apps/cloudflare verify` passed;
  `bash scripts/workspace-verify.sh test:diff <touched slice paths>` passed,
  including `apps/cloudflare verify` and `apps/web verify`.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
