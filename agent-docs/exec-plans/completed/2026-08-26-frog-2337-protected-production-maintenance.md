# Remove unreadable Vercel production maintenance commands

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make every active repository instruction for database-backed production
  maintenance truthful about where the production credential is available.
- Keep production database authority in the existing protected GitHub
  `production` environment and its exact-deployment/drain gate.

## Success criteria

- No active Web operator guide or maintenance-script help text tells an operator
  to fetch production database credentials with `vercel env run`.
- The Web owner documents the fixed process for adding a bounded,
  task-specific maintenance step to the existing protected workflow.
- Focused regression proof fails if one of the affected active operator
  surfaces reintroduces the unreadable command path.

## Scope

- In scope: active Web operator documentation, maintenance-script help text,
  and focused repository guard coverage.
- Out of scope: production data access, secret retrieval, a generic command
  runner, a second workflow, and changes to application or deployment behavior.

## Constraints

- Technical constraints: Vercel Sensitive values are non-readable after
  creation; the existing GitHub `production` environment is the readable
  credential owner.
- Product/process constraints: preserve exact-deployment proof, the
  prior-function drain, bounded dry-run/apply/check semantics, and review of
  every production maintenance command.

## Risks and mitigations

1. Risk: a broad replacement path could allow arbitrary production commands.
   Mitigation: document a task-specific workflow extension and explicitly
   reject generic command inputs or duplicate secret paths.
2. Risk: historical artifacts or the trusted Frog entry could be rewritten.
   Mitigation: change only live owner docs, script help text, and focused tests.

## Tasks

1. Prove the unreadable-secret root cause from the committed Frog entry,
   repository configuration, and current official Vercel behavior.
2. Add a focused failing guard for the affected active operator surfaces.
3. Replace broken production command examples with the existing protected
   workflow contract and local/test-only invocation syntax.
4. Run focused tests, typecheck/readback, docs checks, and final diff/privacy
   inspection.
5. Commit, push, open a draft PR, and complete the routed review/CI gates.

## Decisions

- Reuse `.github/workflows/hosted-web-contract-migrations.yml`; do not add a
  generic production-command input, new workflow, or new secret owner.
- Keep each concrete production maintenance operation reviewable as a bounded
  task-specific workflow step.

## Verification

- Commands to run: focused `production-migration-guard` Vitest, Web typecheck,
  docs drift/gardening, `git diff --check`, scoped final diff/privacy scan.
- Expected outcomes: all checks pass and the active operator surfaces contain
  no `vercel env run --environment=production` command.
Completed: 2026-08-26
