# Web-control preflight monitoring review remediation

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Replace the container-only preflight warning with one privacy-safe event that
  reaches Murph's existing durable hosted runtime-log owner.

## Success criteria

- Every observed allowlist rejection attempts one durable runtime-log write
  before rejected-target egress.
- The event carries only the dedicated error code, method, policy operation,
  rejection reason, and transport mode.
- The route, query, payload, description, member id, response, and credentials
  never enter the log body.
- Logging failure preserves the original typed, fail-closed policy error.
- The change adds no queue, persisted state, endpoint, retry owner, or fallback
  egress path.

## Scope

- In scope: Cloudflare web-control transport composition, the existing runtime
  log event contract, focused boundary tests, and owning reliability/operator
  documentation.
- Out of scope: route admission, mailbox behavior, provider delivery, database
  schema, alert infrastructure, and production deployment.

## Evidence and decision

- Exact-head review proved the first implementation wrote only to container
  stdout, which is not queryable after the container exits.
- Reuse the existing runtime-log port as the sole durable boundary. The port is
  built from the unadorned allowlisted transport; all other web-control ports
  receive the reporting wrapper, preventing recursive rejection logging.
- Keep telemetry best-effort so observability cannot mutate policy behavior.

## Tasks

1. Remove the ineffective container-only event.
2. Compose preflight reporting with the existing durable runtime-log port.
3. Add production-composition proof for one persisted redacted event, zero
   rejected-target requests, and original-error preservation on log failure.
4. Update canonical reliability and operator-query documentation.
5. Run focused tests, package builds/typechecks, complexity and docs guards,
   commit the remediation, and rerun exact-head ReviewGPT with CI.

## Progress

- Tasks 1-5 completed for the implementation candidate.
- The exact pushed head still requires the repository's ordinary ReviewGPT and
  required GitHub checks before merge.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-platform.test.ts --no-coverage -t "web-control preflight|preflight log write"`
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-runtime-control.test.ts --no-coverage -t "keeps runtime logs structured and privacy-bounded"`
- `pnpm --dir packages/hosted-execution build`
- `pnpm --dir apps/cloudflare build`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm complexity:diff`
- `pnpm docs:drift`

## Results

- Cloudflare runtime-platform tests: 205 passed.
- Hosted-execution runtime-control tests: 35 passed.
- Cloudflare typecheck and both affected package builds passed.
- Complexity remained unchanged in every affected production file.
- Documentation drift, whitespace, and privacy scans passed.
- The final design reuses the durable hosted runtime-log port and adds no new
  endpoint, schema, queue, persisted state, retry owner, or telemetry backend.
Completed: 2026-09-02
