Goal (incl. success criteria):
- Simplify hosted container CPU watchdog diagnostics by logging useful process names directly instead of keyed unknown-process fingerprints.
- Success means the watchdog no longer needs a watchdog fingerprint env var or derived HMAC key, and process names are still bounded to allowlisted kernel `comm` values with unknown names redacted.

Constraints/Assumptions:
- Preserve unrelated dirty work and do not deploy, push, or merge.
- Keep the change scoped to the CPU watchdog process-attribution path, direct env plumbing removal, tests, and the matching security doc sentence.
- Kernel `comm` is the intended diagnostic surface for known infrastructure process names; do not log unknown names, command lines, argv, file paths, prompts, request bodies, transcripts, or vault content.

Key decisions:
- Remove stable unknown-process HMAC labels instead of adding or keeping a separate watchdog secret.
- Emit raw `comm` only for known infrastructure process names; otherwise emit a fixed redaction marker.

State:
- Active.

Done:
- Read routing, security, reliability, verification, and relevant watchdog/env tests.

Now:
- Remove watchdog fingerprint env plumbing and update watchdog process-name sanitization.
- Accepted security review finding: shape-based comm sanitization could still leak safe-looking identifiers, so the implementation moved to an explicit known-process allowlist.

Next:
- Run focused tests/typecheck/audits, then finish with a scoped commit if clean.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/container-cpu-watchdog.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/container-cpu-watchdog.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/env.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`
- `agent-docs/SECURITY.md`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
