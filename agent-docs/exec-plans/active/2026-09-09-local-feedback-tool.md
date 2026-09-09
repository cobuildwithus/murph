# Local feedback diagnostics client

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Outcome

Ship PR #3083 through Web-first deployment and runtime convergence, then provide
a small local agent command for feedback listing, diagnostic requests and answers.

## Boundaries

Reuse the existing Ops session, allowlist, CSRF and feedback API. A dedicated
machine-local browser profile holds the session; agents never copy cookie values
or use production database credentials. No server auth changes, queue or cron.
The command has one fixed production origin and never follows API redirects.

## Verification

Prove argument bounds, idempotency identity, fixed endpoint/origin, redirect denial,
safe failures and session isolation with synthetic tests and relevant typecheck.
Verify the deployed Web revision, additive migration and runtime convergence.
Exercise local login and a bounded authenticated read when an Ops session is
available. Run the required review on the local client before completion.

## Progress

PR #3083 merged as `90085f6103cf667335fd50301735dabcb91d09ed`.
Web is Ready on the canonical production alias and the migration is applied.
Unauthenticated production API requests return 401. Protected Cloudflare run
`34378400152` is executing full predeploy gates before immediate rollout.
The client passes 17 focused tests, standalone strict typecheck, shell syntax
and complexity checks. Live unsigned CLI calls fail closed with a login hint.
Interactive Ops login is pending human sign-in; no credential has been read.
