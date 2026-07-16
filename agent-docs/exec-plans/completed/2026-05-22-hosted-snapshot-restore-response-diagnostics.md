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

1. Reproduce the current no-reply state with iMessage, production database inspection, and Cloudflare
   Observability.
2. Add targeted Worker-boundary diagnostics for internal outbound response
   status/body shape and workspace snapshot presign branch outcomes.
3. Add fixed-vocabulary child restore failure categorization after the
   data-key/presign/object checks prove healthy.
4. Run focused Cloudflare tests and typecheck.
5. Deploy via `cf:deploy:immediate`, then use iMessage plus Cloudflare/production database evidence
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
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-restore-codex-continuity.test.ts`
  passed after adding the v2 continuity repair cases.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `git diff --check -- packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts packages/hosted-execution/src/runtime-control.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.
- Privacy scan of the scoped diff for local identifiers, phone numbers, auth
  headers, bearer tokens, and secret-looking API keys returned no matches.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts packages/hosted-execution/src/runtime-control.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed. Existing web lint warnings and a Next.js NFT trace warning remain
  outside this patch.
- `pnpm cf:deploy:immediate` completed the production Cloudflare deploy and
  smoke tests passed.
- Post-deploy Cloudflare Observability returned no error-level events and no
  hosted container failure events during the controlled repro window.
- Post-deploy production database evidence for the first controlled iMessage repro showed a
  new `conversation.message`, fixed-vocabulary
  `workspace.codex_continuity_repaired` events, `outbox.delivery_finished`,
  `assistant.pass_finished`, and checkpoint completion.
- Post-deploy production database evidence for the second controlled iMessage repro showed a
  new `conversation.message`, `outbox.delivery_finished`,
  `assistant.pass_finished`, and checkpoint completion without another
  continuity repair event.
- Computer Use verified both controlled repros received visible iMessage replies
  from Murph.

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
- Post-deploy child diagnostics now show corrupted/stale Codex continuity as the
  dominant restore failure class: missing rollout coverage, unmanifested Codex
  home files, and one rollout size mismatch. One data-key unwrap 404 also
  occurred, but data-key/presign routes otherwise completed successfully and the
  recurring blocker is continuity validation.
- The newest user text has not reached the local Messages transcript or the
  production mailbox `conversation.message` lane yet; current repair work is for
  the earlier post-deploy ping that did reach hosted runtime and failed restore.
- Current patch intent: on v2 snapshot restore, if only Codex provider continuity
  validation is corrupt, clear provider resume continuity and continue from the
  restored vault/mailbox state with a fresh provider session instead of failing
  the whole hosted run.
- Production repair is deployed and verified. The first controlled repro repaired
  stale Codex continuity state and replied; the second controlled repro replied
  without needing another continuity repair. No post-deploy Cloudflare error or
  container-failure events were observed in the repro window.

## Open Questions

- None for this incident.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
