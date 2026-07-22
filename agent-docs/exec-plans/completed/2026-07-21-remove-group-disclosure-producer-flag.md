# Remove the consented group disclosure producer flag

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Hard-cut consented group disclosure to its shipped Web and runner protocol by
  deleting the temporary Web producer flag.
- Push the deletion to `main`, then run and verify the repository-owned
  production Cloudflare deployment workflow.

## Success criteria

- Otherwise-authorized disclosure permission posts and `ask_member` requests
  no longer depend on an environment variable.
- The flag constant, parser, disabled branches, environment example, mocks, and
  flag-only tests are deleted.
- Live rollout documentation describes the compatible runner as the rollback
  floor instead of a disabled producer mode.
- Existing authority, grant, route, review, expiry, and runtime-fence checks are
  unchanged.
- The scoped commit fast-forwards `main`, and `pnpm cf:deploy` completes the
  production Cloudflare workflow successfully.

## Scope

- Web Assistant Ask admission and disclosure permission posting.
- Focused hosted group tests and current rollout/protocol/product docs.
- The repository-owned production Cloudflare deployment command and its run.

## Constraints

- Delete the temporary gate; do not replace it with state, configuration, or a
  second rollout abstraction.
- Do not edit historical completed plans.
- Preserve the existing ten-minute drain/rollback floor and all live authority
  checks.

## Tasks

1. Delete the producer gate and its flag-only tests/config.
2. Update current rollout documentation to the hard-cut protocol.
3. Run focused and diff-aware verification plus required completion audits.
4. Commit, reconcile, fast-forward `main`, run `pnpm cf:deploy`, and verify the
   production workflow result.

## Decision

- The consumer protocol is already merged and compatible, so availability now
  derives only from ordinary request authority and health—not a second feature
  switch.

## Progress

- Deleted the flag constant, parser, producer branches, environment example,
  mocks, and flag-only tests without changing disclosure authority or replay
  validation.
- Replaced the gated rollout instructions with the compatible-runner rollback
  floor and ten-minute drain contract.
- Coverage review found the existing runtime-fence replay regression sufficient.
  Deep review found no release-blocking issue and removed one obsolete test
  environment teardown left behind by the deleted gate.

## Verification

- `pnpm test:diff`
- Focused hosted group Assistant Ask and group-tool Vitest files
- Web TypeScript, lint, development smoke, production build, and full test suite
- Cloudflare TypeScript, Node tests, and Workers tests
- `pnpm docs:drift`
- `git diff --check`

## Deployment outcome

- Pushed the hard deletion to `main` at commit
  `35d113843b0e76f3b9aeaf0b778f3f169fa00ae8`.
- `pnpm cf:deploy` completed successfully in
  [production workflow run 29876321410](https://github.com/cobuildwithus/murph/actions/runs/29876321410).
- All five predeploy gates, the Worker deploy, and the deployed-endpoint smoke
  passed. The endpoint smoke held until Cloudflare served the expected runner
  bundle, then completed green.
Completed: 2026-07-21
