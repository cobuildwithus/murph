Goal (incl. success criteria):
- Close the `review:gpt` finding that the CPU-watchdog derived key is exposed under the generic `HOSTED_LOG_FINGERPRINT_SECRET` container env name.
- Success means the container startup env uses a watchdog-only key, the raw Worker log fingerprint key remains absent from container env, and assistant context diagnostics do not become enabled by the watchdog key.
- The watchdog-only key also must not be projected into hosted runtime forwarded/user env or accepted as a member runner secret.

Constraints/Assumptions:
- Preserve unrelated dirty work and do not deploy, push, or merge.
- Keep the fix scoped to the watchdog env boundary and direct regression coverage.
- The Worker-owned `HOSTED_LOG_FINGERPRINT_SECRET` remains the derivation source, but the container receives only a purpose-derived value under a distinct env key.

Key decisions:
- Use a distinct container-only key for the CPU watchdog instead of reusing `HOSTED_LOG_FINGERPRINT_SECRET`.
- Add a direct assistant-engine regression so future env-name reuse cannot silently enable assistant context fingerprints.
- Deny the watchdog-only key in hosted runtime env projection and runner-secret policy so the key stays container-startup-only.

State:
- Follow-up fix from `review:gpt` is complete and ready for scoped commit.

Done:
- Ran `review:gpt` on commit `4d244d463`; exported the completed response after the initial capture was incomplete.
- Verified the finding against `packages/assistant-engine/src/assistant/hosted-context-diagnostics.ts`.
- Implemented the watchdog-only env name and runtime/runner-secret denylist follow-up from the security audit.
- Added direct regressions for container startup env, watchdog env reads, assistant diagnostics, runtime env projection, and runner-secret policy.

Now:
- Close the plan with `scripts/finish-task`.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None blocking.

Working set (files/ids/commands):
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/container-cpu-watchdog.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/container-cpu-watchdog.test.ts`
- `apps/cloudflare/test/env.test.ts`
- `packages/assistant-engine/test/assistant-hosted-context-diagnostics.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`
- `agent-docs/SECURITY.md`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
