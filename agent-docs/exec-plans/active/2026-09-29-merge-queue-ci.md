# Merge queue support for required CI

Status: active
Created: 2026-09-29
Updated: 2026-09-29

## Goal

- Let `main` use a GitHub merge queue so every merge is verified on the exact
  merged result, and stop re-running the heavy Host Support suite on the main
  push that fast-forwards to an already verified merge-queue commit.

## Success criteria

- Every required check (`CLI host matrix (ubuntu-24.04)`,
  `CLI host matrix (macos-latest)`, `Release checks (ubuntu)`,
  `Required hosted Stripe billing boundary`) runs and reports on
  `merge_group` in full mode.
- A main push whose SHA already has a successful Host Support `merge_group`
  run skips the heavy Host Support jobs. Any other main push, including a
  direct admin push or an API failure, runs the full suite.
- Pull-request behavior (ready-only admission, draft guard, Markdown docs
  mode) is unchanged.
- Workflow policy tests encode the new event and receipt contract.

## Scope

- In scope: `host-support.yml`, `hosted-stripe-billing.yml`, their policy
  tests and guard scripts, and the living CI docs.
- Out of scope: enabling the merge-queue rule in the `Protect main` ruleset.
  That is a repository setting applied after merge, once maintainers are told.
  Non-required PR workflows (Repo Hygiene, viewport, cardinality, evidence)
  keep their current triggers.

## Constraints

- Technical constraints: the receipt lookup fails closed to a full run. It is
  read-only (`actions: read`), and it trusts only Actions runs of this workflow
  file with event `merge_group` and conclusion `success` on the same SHA.
- Product/process constraints: merges from the queue wait for one full Host
  Support run on the merged result.

## Risks and mitigations

1. Risk: the queue merges a commit whose SHA differs from the tested
   merge-group SHA, so the receipt never matches.
   Mitigation: the lookup is fail-closed, so the result is a full run, which is
   today's behavior. Only the optimization is lost.
2. Risk: a forged success signal skips main CI.
   Mitigation: the receipt reads workflow runs, not check runs. Only GitHub
   Actions creates workflow runs for this workflow file, and `merge_group`
   runs execute trusted queue commits.

## Tasks

1. Add `merge_group` triggers and the Stripe `merge_group` receipt mode.
2. Add the Host Support main-push merge-queue receipt job and gate heavy jobs.
3. Update policy tests, guard scripts, and docs.
4. Focused tests; PR; post-merge ruleset change is handed to the user.

## Decisions

- Stripe keeps its single hermetic job on main push; deduplicating it saves
  one job and adds another event mode.

## Verification

- Commands to run: `node --test scripts/pull-request-ci-policy.test.mjs`,
  `pnpm hosted-billing:ci-guard`, Stripe guard tests, `pnpm test:repo-tools`,
  release workflow guard tests, actionlint.
- Expected outcomes: all pass. The merge-group path is proven live only after
  the ruleset enables the queue.
