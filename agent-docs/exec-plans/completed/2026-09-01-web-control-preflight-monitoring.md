# Web-control preflight monitoring

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make Cloudflare web-control allowlist rejections immediately visible as typed,
  privacy-safe structured logs and preserve a dedicated error code in the
  existing hosted runtime-log warning.

## Success criteria

- A rejected preflight emits one warning before any network request.
- The warning exposes only the bounded method, policy operation, reason, and
  dedicated error code; it contains no member id, payload, URL, or credentials.
- The thrown error carries the dedicated code through the existing system
  mailbox retry log.
- Focused Cloudflare regression coverage and typecheck pass.

## Scope

- In scope: the shared Cloudflare web-control transport preflight, focused
  tests, and durable observability documentation.
- Out of scope: route admission, mailbox retry behavior, provider delivery,
  alert infrastructure, database schema, and production deployment.

## Constraints

- Technical constraints: keep the exact fail-closed allowlist behavior and
  issue no request after rejection.
- Product/process constraints: internal-only monitoring change with no member
  interaction or provider-input change; use the existing structured logger and
  runtime-log owner.

## Risks and mitigations

1. Risk: logging an arbitrary path could expose sensitive route material.
   Mitigation: log only the existing closed policy operation and HTTP method;
   keep the path solely in the already-sanitized error message.
2. Risk: a new error code could change retry behavior.
   Mitigation: retain the same thrown-error and system-mailbox retry path; only
   improve classification.

## Tasks

1. Add a typed preflight error and warning at the current policy assertion.
2. Add regression coverage for log shape, error propagation, and zero fetches.
3. Document the operator query/filter contract.
4. Run focused verification, inspect the diff, and complete the PR gates.

## Decisions

- Reuse the existing structured logger and hosted runtime-log warning instead
  of adding state, a queue, or a new telemetry backend.
- Do not log the rejected route. The bounded request description identifies the
  caller family while the typed policy operation and error code identify the
  failure mechanism.

## Progress

- Added the typed preflight error and one warning before egress.
- Removed the now-redundant assertion wrapper so policy lookup remains the
  single decision source.
- Added a regression proving the warning shape, dedicated code, route omission,
  and zero network requests.
- Documented the Workers filter and runtime-log aggregate query.
- Extracted the decision into a single-purpose helper after the complexity gate
  detected a one-point increase in the existing transport hotspot.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-platform.test.ts --no-coverage -t "logs web-control preflight rejections before egress"`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm complexity:diff`
- Expected outcomes: the focused regression proves one warning, a dedicated
  code, and zero fetches; typecheck and complexity checks pass.

Focused regression: passed (1 test, 203 filtered out).
Cloudflare typecheck: passed.
Initial complexity check: correctly failed on a one-point hotspot increase;
the preflight decision was then extracted without changing behavior.
Final complexity check: passed with unchanged debt and maximum complexity.
Documentation drift check: passed.
Diff whitespace and privacy scans: passed.

## Outcome

- Pre-egress policy failures now have an immediate, queryable Cloudflare event
  and a dedicated code in the existing durable retry warning.
- The network and retry behavior are unchanged, and the new telemetry excludes
  route material and direct identifiers.
Completed: 2026-09-01
