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
3. Run focused Cloudflare tests and typecheck.
4. Deploy via `cf:deploy:immediate`, then use iMessage plus Cloudflare/DBHub
   evidence to identify the exact failing branch.
5. Patch the proven root cause, rerun focused verification, redeploy, and verify
   Murph replies reliably.

## Verification

- `pnpm --dir apps/cloudflare test:node -- runner-egress-intercept.test.ts runner-outbound.test.ts`
  passed; the command ran the Cloudflare node workspace.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check -- apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-snapshot-restore-response-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.

## State

- Fresh iMessage repro appended a new conversation item, woke the hosted
  runner, and production logged metadata-only runtime adapter failures before
  any reply-send path.
- Current production diagnostics narrow the failure to v2 workspace snapshot
  restore, but they do not yet log the internal outbound response status/body
  shape for the control-plane request that the child reports as HTTP 404.
- Added metadata-only Worker-boundary response diagnostics and presign GET
  branch diagnostics. Next step is immediate production deploy and another
  iMessage repro.

## Open Questions

- Does the Worker actually return 404 from the data-key/presign route, or is
  the child reporting a hidden/stale response from another control-plane edge?
- If the Worker returns 404, which redacted branch produced it?
