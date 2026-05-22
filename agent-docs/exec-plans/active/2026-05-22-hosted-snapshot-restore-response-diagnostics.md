## Goal

Restore reliable hosted Murph replies by diagnosing the production workspace
snapshot restore failure at the Worker/control-plane boundary and applying the
smallest durable fix once the failing branch is proven.

## Constraints

- Do not log or document raw user ids, snapshot ids, object keys, request ids,
  attempt ids, workspace ids, phone numbers, message text, prompts, transcripts,
  presigned URLs, response bodies, local paths, secrets, or provider payloads.
- Diagnostics must stay metadata-only and use fixed vocabularies or presence
  booleans where possible.
- Use the immediate Cloudflare deploy path after scoped verification so the
  iMessage repro can be tested against production promptly.
- Preserve unrelated active hosted-runner and Temporal work.

## Plan

1. Reproduce the current no-reply state with iMessage, DBHub, and Cloudflare
   Observability.
2. Add targeted Worker-boundary diagnostics for internal outbound response
   status/body shape and workspace snapshot presign branch outcomes.
3. Add fixed-vocabulary child restore failure categorization after the
   data-key/presign/object checks prove healthy.
4. Run focused Cloudflare tests and typecheck.
5. Deploy via `cf:deploy:immediate`, then use iMessage plus Cloudflare/DBHub
   evidence to identify the exact failing branch.
6. Patch the proven root cause, rerun focused verification, redeploy, and verify
   Murph replies reliably.

## Verification

- `pnpm --dir apps/cloudflare test:node -- runner-egress-intercept.test.ts runner-outbound.test.ts`
  passed; the command ran the Cloudflare node workspace.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check -- apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.
- `pnpm --dir apps/cloudflare test:node -- node-runner-child.test.ts runner-container.test.ts container-entrypoint.test.ts`
  passed after adding the child error-message category propagation tests.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check -- apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-child-diagnostics.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/container-entrypoint.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.

## State

- Fresh iMessage repro appended a new conversation item, woke the hosted
  runner, and production logged metadata-only runtime adapter failures before
  any reply-send path.
- Production diagnostics proved the affected snapshot's active crypto root,
  encrypted object bytes/digest, data-key unwrap route, and presign GET route are
  healthy.
- The remaining blind spot is the fixed restore/continuity failure class inside
  the child after successful data-key/presign/object setup.
- Adding metadata-only child runtime error-message categories so the next
  production attempt can name the failing class without logging message text,
  paths, object keys, hashes, or payloads.

## Open Questions

- Which fixed child restore failure category appears after the next deploy and
  retry?
- Did the user's newest iMessage reach hosted ingress, or is there a separate
  upstream/local Messages delivery gap to investigate after runtime restore is
  observable?
