# Land hosted-local command surface cleanup

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the supplied hosted-local greenfield cleanup intent against the current
  checkout.
- Success means the root `hosted-local` command is the canonical local hosted
  harness surface, root `dev` delegates through it, Cloudflare hosted-local E2E
  package scripts collapse to one generic alias, CI calls root harness scenarios,
  and focused tests/docs prevent command-surface drift.

## Success criteria

- Root `package.json` exposes `hosted-local`, routes `dev` through
  `hosted-local up`, and adds `test:e2e:hosted-local`.
- `apps/cloudflare/package.json` keeps one generic hosted-local E2E script plus
  broad compatibility aliases only.
- `.github/workflows/cloudflare-hosted-e2e.yml` calls root
  `pnpm hosted-local e2e <scenario>` commands and uploads hosted-local
  artifacts.
- `runHostedLocalE2eSuite(...)` prepares the runner bundle unless callers opt
  out.
- Harness help, README, and durable verification docs match the new command
  surface.
- Focused repo-tool tests and required verification/review steps pass or have
  isolated unrelated blockers documented.

## Scope

- In scope:
  - Root/package command aliases.
  - Hosted-local harness CLI/E2E default behavior.
  - Hosted E2E GitHub workflow command calls and artifact paths.
  - Harness README plus verification/CI docs that describe the changed command
    surface.
  - Focused guard coverage in `scripts/hosted-local.test.ts`.
- Out of scope:
  - Runtime behavior of hosted assistant turns, Cloudflare Durable Objects, web
    control-plane data, or provider adapters.
  - Live hosted-local E2E execution unless narrow verification requires it and
    the local environment is available.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work already in the checkout.
  - Treat the patch as behavioral intent because it is stale against the current
    tree.
  - Do not add dependencies or lockfile churn.
- Product/process constraints:
  - Do not write personal identifiers, secrets, raw credentials, raw provider
    payloads, or unredacted local paths into files, logs, docs, or commits.
  - Keep the change limited to the hosted-local harness command surface.

## Risks and mitigations

1. Risk: collapsing package scripts removes a legacy scenario command still used
   by docs or CI.
   Mitigation: update the workflow and durable verification docs, and add a
   guard test that fails if bespoke `test:e2e:*:local` scripts return.
2. Risk: runner bundle preparation changes can accidentally skip required E2E
   setup.
   Mitigation: make preparation the programmatic default and preserve explicit
   `--no-bundle`/`prepareRunnerBundle: false` escape hatches for compatibility
   wrappers.

## Tasks

1. Done: port the stale patch intent onto current
   package/workflow/harness files.
2. Done: align verification and CI docs with the canonical command surface.
3. Done: run focused harness checks, command-list proof, docs drift, and
   typecheck.
4. Now: complete required audit reviews and create a scoped commit if the dirty
   checkout allows a safe scoped commit.

## Decisions

- Use root `pnpm hosted-local ...` as the canonical developer and CI entrypoint.
- Keep `apps/cloudflare` package E2E aliases broad and composable instead of
  per-scenario.
- Leave historical plan docs untouched.
- Preserve the harness README's existing state-redaction details while
  simplifying the command-surface guidance.

## Verification

- Passed:
  - `pnpm exec vitest run --config scripts/vitest.config.ts scripts/hosted-local.test.ts scripts/dev-hosted-local/package-script.test.ts --no-coverage`
  - `git diff --check -- <touched paths>`
  - `pnpm hosted-local --help`
  - `pnpm --dir apps/cloudflare test:e2e:hosted-local -- --list`
  - `pnpm typecheck`
  - `pnpm --dir packages/hosted-local-harness typecheck`
  - `pnpm docs:drift`
  - post-security-fix rerun of focused tests, command-list proof,
    `git diff --check`, package typecheck, root typecheck, and docs drift
- Review findings addressed:
  - Security/privacy review found broad `.artifacts/hosted-local/**` CI upload
    could upload future non-redacted scenario artifacts. The workflow now
    uploads only `.artifacts/hosted-local/**/state.json`, and durable docs were
    updated to describe redacted state-file uploads instead of full artifact
    uploads.
  - Final review found stale command-surface guard tests in Cloudflare and CLI.
    Both were updated to assert the generic hosted-local alias, removed
    bespoke scenario scripts, root workflow scenario commands, and narrowed
    redacted state-file artifact upload. Focused reruns passed:
    `apps/cloudflare/test/container-image-contract.test.ts`,
    `packages/cli/test/cloudflare-hosted-e2e-workflow-guards.test.ts`, and
    the hosted-local script guards.
  - Coverage/proof worker found no remaining worthwhile proof additions and
    made no edits.
- Failed for unrelated current-tree reason:
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` was rerun after
    the security fix. It reached the repo-tools suite and failed in
    `scripts/research-init.test.ts` because a Health Commons protocol zip-entry
    expectation was missing. The failure is outside the hosted-local
    command-surface files.
Completed: 2026-05-01
