# Use a least-privilege GitHub App for Frog reconciliation

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Let the protected Friction Log workflow create issue-binding reconciliation
  pull requests without enabling repository-wide `GITHUB_TOKEN` pull-request
  creation or storing a long-lived personal credential.

## Success criteria

- A repository-installed GitHub App is limited to this repository and has only
  Contents, Issues, and Pull requests read/write permissions.
- The workflow mints a short-lived installation token from a Client ID variable
  and a private-key secret in a main-only GitHub Environment, passes it
  explicitly to Frog, and trusts only the configured App bot on issue
  close/reopen events.
- Guard tests fail if the workflow falls back to `github.token`, broad default
  workflow permissions, an unpinned token action, or the old Actions bot.
- The original failed reconciliation is recovered through a real sync pull
  request, required checks pass, and the merged binding is visible on `main`.

## Scope

- In scope: `.github/workflows/friction-log.yml`, its executable guard coverage,
  the Frog workflow documentation, repository App variables, a protected
  environment secret, recovery of the existing `frog/sync` branch, and end-to-
  end verification.
- Out of scope: enabling organization-wide Actions pull-request creation,
  granting bypass or merge authority to the App, autonomous merge of sync pull
  requests, changing product-feedback/support/runtime issue ownership, or
  storing any credential in the repository.

## Constraints

- Technical constraints: use a short-lived GitHub App installation token; keep
  the App installed only on this repository; pin every Action to an exact SHA;
  retain file-backed Frog `1.1.0`, serialized concurrency, default-branch-only
  execution, bot-author filtering, and pull-request-based reconciliation.
- Product/process constraints: never print a secret value or inspect its
  contents; expose only secret/variable names; remove locally generated key
  material immediately after encrypted upload; keep generated issues and
  reconciliation content public-safe; require a human-protected merge.

## Risks and mitigations

1. Risk: a compromised workflow could use the App token for repository writes.
   Mitigation: install the App only on this repository, grant only the three
   required write scopes, expose the key only through a main-only GitHub
   Environment, mint a job-scoped short-lived token, and keep the workflow off
   pull-request events.
2. Risk: an untrusted issue event could trigger write-capable reconciliation.
   Mitigation: keep the default-branch ref gate and require the exact configured
   App bot login at both the job gate and Frog action boundary.
3. Risk: missing App configuration could silently fall back to `GITHUB_TOKEN`.
   Mitigation: require explicit App inputs and add executable assertions that
   forbid the implicit token path.
4. Risk: the App-created PR could bypass review or merge protections.
   Mitigation: do not grant ruleset bypass, do not add approval or merge logic,
   and let ordinary required checks and human merge ownership remain intact.

## Tasks

1. Inspect the failed run, existing secrets/variables, pinned Frog action
   contract, and current GitHub App guidance.
2. Add an exact-SHA App-token minting step and pass the token/bot identity into
   the existing Frog action.
3. Extend focused guard coverage and durable documentation for the credential
   and recovery contract.
4. Create and install the narrowly scoped App, configure names and secret
   material without exposing values, and recover the existing sync branch.
5. Run focused tests/typecheck/docs checks, required completion reviews, exact-
   head CI, and the real issue-to-binding reconciliation proof.

## Decisions

- Keep the organization policy that blocks repository `GITHUB_TOKEN` PR
  creation; it is broader than Frog needs.
- Prefer a dedicated GitHub App over a personal access token because its
  installation and permissions are repository-scoped and its workflow token is
  short-lived.
- Keep sync PR merging human-owned; Frog records and reconciles metadata but
  does not implement or merge issue fixes.

## Verification

- Commands: focused `scripts/frog-workflow-guards.test.ts`, tools typecheck,
  docs drift, YAML/static secret-boundary assertions, `scripts/frog list`,
  current-base merge-tree proof, exact-head CI, and a real workflow rerun.
- Expected outcomes: all local and remote checks pass; the App authors the
  issue/PR operations; `frog/sync` opens a normal reconciliation PR; no secret
  value appears in the diff or logs; the binding reaches `main` after merge.
