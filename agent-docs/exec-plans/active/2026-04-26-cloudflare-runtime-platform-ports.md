# Cloudflare Runtime Platform Ports

Goal (incl. success criteria):
- Add the Cloudflare-hosted runtime platform adapter for greenfield mailbox, workspace checkpoint, runtime log, and share payload/import ports.
- Keep Cloudflare as a transport/lease adapter only; do not add mailbox state, run acquire/commit/finalize, committed sequence, or queue-history ownership.
- Focused Cloudflare tests prove route bodies, response parsing, and parent-owned web callback/proxy transport.

Constraints/Assumptions:
- User requested no commits.
- Preserve unrelated dirty work in the shared checkout.
- Web internal route handlers may still be in flight; use shared hosted-execution route constants and parsers instead of inventing fallback names.
- Child/runtime owns import/checkpoint timing. This task wires ports only.
- No raw secrets, plaintext payloads, local paths, or direct identifiers in logs or fixtures.

Key decisions:
- Keep existing run-shaped ports for compatibility while adding greenfield semantic ports.
- Route web callbacks through the existing direct signed callback transport or worker proxy transport.
- Carry share-owner callback signing through the parent proxy with a narrow internal header allowed only on share payload/import routes.

State:
- Implemented, focused-verified, and reviewed. No commit per user instruction.

Done:
- Required repo docs read.
- Existing contracts and Cloudflare adapter inspected.
- `apps/cloudflare/src/runtime-platform.ts` now exposes mailbox/workspace/log/share platform ports over the shared web callback route constants.
- `apps/cloudflare/src/runner-outbound/*web-control*` now allows the new semantic web-control paths, GET payload fetch routes, and share-only signed-user proxy overrides.
- Web-control proxy allowlisting is method-aware, and structured logs use static route templates for dynamic side-input callback paths.
- Focused Cloudflare tests cover mailbox fetch, workspace checkpoint fencing fields, runtime logs, share owner signing, and the actual parent outbound proxy path.
- Verification passed:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check -- apps/cloudflare/src/runtime-platform.ts apps/cloudflare/src/runner-outbound/web-control.ts apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/active/2026-04-26-cloudflare-runtime-platform-ports.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Now:
- Handoff.

Next:
- Worker 1/web route integration should land or verify share payload/import handlers behind the shared route constants.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Worker 1 will land the actual web handlers under the shared route constants already present in `packages/hosted-execution`.

Working set (files/ids/commands):
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/runner-outbound/web-control.ts`
- `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`
- `agent-docs/exec-plans/active/2026-04-26-cloudflare-runtime-platform-ports.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
