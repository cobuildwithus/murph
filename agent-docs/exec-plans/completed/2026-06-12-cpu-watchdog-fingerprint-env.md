Goal (incl. success criteria):
- Let the hosted container CPU watchdog emit stable keyed digests for unknown process `comm` names by making a purpose-derived key from the existing platform fingerprint secret available to the container entrypoint only.
- Success means the raw Worker-owned secret remains blocked from user env, runtime job payloads, hosted runtime env surfaces, and container env, while `RunnerContainer.envVars` carries only a purpose-derived watchdog key and focused tests prove both sides.

Constraints/Assumptions:
- Do not deploy, merge, or push `main`.
- Preserve unrelated active-plan and working-tree edits.
- Keep the change narrowly scoped to `apps/cloudflare`.
- Do not print, persist, fixture, or commit raw secret values beyond synthetic test strings.
- Cloudflare Containers support passing Worker-derived values through `Container.envVars`; repo security policy requires that the raw Worker fingerprint secret does not enter runtime/user env forwarding surfaces or container env.

Key decisions:
- Derive a CPU-watchdog-specific HMAC key from the existing `HOSTED_LOG_FINGERPRINT_SECRET` binding and pass only that derived key as a container startup env var instead of widening hosted runtime env policy or job payloads.
- Do not add new persisted state, routes, or deploy config; the secret is already a required Worker secret.

State:
- Implementation, verification, and required audits complete; ready for plan closure and scoped commit if the dirty checkout permits it.

Done:
- Read required repo workflow, architecture, invariant, product, security, reliability, completion, and verification docs.
- Recovered prior Claude session context and verified the root cause: watchdog code reads `process.env.HOSTED_LOG_FINGERPRINT_SECRET`, but `RunnerContainer.envVars` does not set it.
- Checked current Cloudflare Containers docs for `envVars` support.
- Added derived-key container startup env construction in `RunnerContainer`.
- Added focused runner-container coverage proving the raw Worker secret is not passed and usage-reporting secret is not used as a startup-env fallback.
- Removed the watchdog's stale `HOSTED_AI_USAGE_REPORTING_SECRET` fallback and added direct watchdog coverage proving unknown comms collapse to `other` without the log fingerprint key.
- Updated `agent-docs/SECURITY.md` for the derived CPU-watchdog HMAC key exception.
- Ran focused tests, Cloudflare typecheck, scoped `test:diff`, security/privacy review, coverage-write review, deep review, and task-finish review.

Now:
- Closing the active plan through the repo finish-task path.

Next:
- None after successful finish-task commit.

Open questions (UNCONFIRMED if needed):
- None blocking.

Working set (files/ids/commands):
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/container-cpu-watchdog.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/container-cpu-watchdog.test.ts`
- `apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts` if payload-invariant coverage needs adjustment
- `agent-docs/SECURITY.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
