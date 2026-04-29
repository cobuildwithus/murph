# Install pinned Codex CLI in Cloudflare runner image

Status: active
Created: 2026-04-28
Updated: 2026-04-29

## Goal

- Restore the production Cloudflare hosted execution deploy by installing a
  pinned Codex CLI in the hosted runner container image so the managed runner
  can launch `codex app-server`, and keep the Murph CLI shims discoverable
  from Codex login-shell tool commands.

## Success criteria

- `pnpm cf:deploy:immediate` no longer fails before Worker upload because the
  runner image lacks `codex`.
- The runner base image installs `@openai/codex@0.125.0` from the public npm
  registry and exposes `codex` on the container `PATH`.
- Existing smoke coverage continues to execute `codex --version` and
  `codex app-server --help`; image-contract tests assert the install contract.
- The real Docker smoke runs a Codex app-server `command/exec` probe through
  `/bin/sh -lc`, proving hosted login-shell commands can resolve and execute
  `vault-cli --llms --format json` plus `murph --help`.

## Scope

- In scope:
  - `Dockerfile.cloudflare-hosted-runner-base`
  - Directly coupled Cloudflare image/smoke contract tests.
  - Durable Cloudflare deploy docs if they describe base-image contents.
- Out of scope:
  - Assistant-runtime provider behavior.
  - Cloudflare Worker route/auth behavior.
  - Hosted web, Health Commons, and unrelated active runner lanes.

## Constraints

- Technical constraints:
  - Keep the app image layer app-only; install the CLI in the stable runner base
    image with an exact version pin.
  - Debian `/etc/profile` resets PATH for non-root login shells, so the base
    image must restore the app bundle bin path through profile initialization
    rather than relying only on Dockerfile `ENV PATH`.
  - Do not add secrets or auth material to the image.
  - Preserve the existing `codex app-server --help` smoke proof.
- Product/process constraints:
  - Preserve unrelated dirty/staged work in the shared checkout.
  - Do not include local usernames, home paths, legal names, secrets, raw
    credentials, or direct personal identifiers in files, logs, or handoff.

## Risks and mitigations

1. Risk: An unpinned global CLI install changes deploy behavior unexpectedly.
   Mitigation: Pin `@openai/codex@0.125.0` in the Dockerfile and assert it in
   image-contract tests.
2. Risk: The CLI exists but no longer exposes the app-server command needed by
   hosted assistant execution.
   Mitigation: Keep the smoke child preflight that runs
   `codex app-server --help` inside the built container image.

## Tasks

1. Confirm the failed GitHub Actions run and root cause.
2. Patch the runner base image to install the pinned Codex CLI.
3. Strengthen image contract tests/docs around the Codex install, login-shell
   PATH initialization, and smoke command.
4. Run focused Cloudflare contract/smoke verification.
5. Run required completion audits, close this plan, and create a scoped commit.

## Decisions

- Install Codex CLI in `Dockerfile.cloudflare-hosted-runner-base`, not the app
  Dockerfile, because the base image is the stable runtime toolchain layer that
  already carries native parser tools and is prepared before deploy/smoke.
- Pin `@openai/codex@0.125.0`; registry lookup on 2026-04-28 returned that as
  the current package version and its `codex` binary.
- Preserve `/app/node_modules/.bin` for Codex login-shell commands with
  `/etc/profile.d/murph-runner-path.sh`, because hosted tool commands can
  execute as `/bin/sh -lc` and Debian's default `/etc/profile` otherwise
  overwrites the Dockerfile `ENV PATH` for the non-root runner user.

## Verification

- Commands to run:
- `pnpm exec vitest run apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/hosted-runner-smoke-contract.test.ts apps/cloudflare/test/hosted-runner-smoke.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir apps/cloudflare runner:docker:smoke`
- `git diff --check`
- Expected outcomes:
- Focused contract/typecheck checks pass.
- Docker smoke confirms the image has `codex` and that
  `codex app-server --help` exits successfully.
