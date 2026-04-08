# Refactor Cloudflare hosted runner packaging to built-artifact deploy shape

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Move the Cloudflare hosted runner deploy path off repo-source execution and onto a built-artifact package shape that installs only the runtime closure the hosted runner actually needs.
- Eliminate hidden runtime dependency on workspace source fallbacks for `vault-cli`, so hosted execution can run from packaged artifacts instead of a full repo checkout.

## Success criteria

- The hosted runner container entrypoint and isolated child path run from built artifacts rather than `tsx` + repo source imports.
- Hosted assistant CLI execution resolves through an explicit packaged CLI surface, not relative workspace source paths.
- The Cloudflare deploy packaging path no longer requires copying the whole repo source tree or installing the full workspace dependency graph in the final runtime image.
- Docs and tests are updated to describe and verify the new packaging/runtime contract.
- Required repo verification passes for this change surface complete, plus at least one direct packaging scenario check.

## Scope

- In scope:
- `Dockerfile.cloudflare-hosted-runner`, `.dockerignore`, and hosted deploy/package assembly for `apps/cloudflare`
- runtime changes needed to support built-artifact execution in the hosted runner
- assistant CLI launch-path changes needed to remove repo-source fallback in hosted execution
- focused docs/tests for the hosted runner packaging and deploy contract
- Out of scope:
- functional behavior changes to hosted onboarding, billing, share acceptance, or device-sync semantics
- unrelated hosted-web UX/auth work already active elsewhere
- speculative runtime splitting beyond what the packaging refactor requires

## Constraints

- Technical constraints:
- Preserve existing hosted execution behavior, trust boundaries, and parser tool availability.
- Preserve the current Whisper/ffmpeg/pdftotext runtime contract unless a change is explicitly justified and covered.
- Avoid introducing new package cycles or sibling-internal imports.
- Product/process constraints:
- Keep unrelated worktree edits intact.
- Treat this as a high-risk deploy/runtime change: update docs and keep verification/proof explicit.

## Risks and mitigations

1. Risk: Hosted execution may rely on undeclared runtime coupling that only works from a repo checkout.
   Mitigation: Trace the runtime closure first, make hidden dependencies explicit or remove them, and add focused tests around the new packaging contract.
2. Risk: CLI execution inside hosted runs could break if `vault-cli` resolution changes.
   Mitigation: Keep a packaged CLI path in the deploy bundle and add tests for CLI resolution behavior.
3. Risk: Docker/build changes could accidentally drop required parser/runtime assets.
   Mitigation: Preserve existing parser env assertions, add packaging-contract tests, and run direct assembly checks before handoff.

## Tasks

1. Replace workspace-source execution assumptions with built-artifact/runtime-package assumptions in the hosted runner path.
2. Remove assistant-engine workspace-relative CLI fallback and switch hosted execution to an explicit packaged CLI dependency.
3. Add a packaging step that assembles the minimal built runtime closure for `apps/cloudflare`.
4. Refactor the Docker image to consume that assembled runtime bundle instead of copying repo source + running a full workspace install.
5. Update tests/docs/verification for the new deploy shape and run required checks.

## Decisions

- Hosted execution should target a packaged runtime closure, not a full repo checkout.
- Hidden workspace-relative CLI fallbacks are not acceptable in the long-term deploy shape; the CLI must be an explicit packaged dependency.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir apps/cloudflare verify`
- `pnpm test:coverage`
- `pnpm --dir apps/cloudflare runner:bundle`
- focused package/deploy assembly checks to prove the new bundle shape
- Expected outcomes:
- Hosted runner code and packaging tests pass against the built-artifact path.
- The deploy assembly contains only the intended runtime closure.

## Outcome

- Hosted runner execution now ships as a built package artifact in the final image instead of running from repo source through `tsx`.
- The Cloudflare deploy workflow now uses a direct worker deploy path rather than the previous gradual rollout inputs.
- `@murphai/assistant-engine` exports were reduced to assistant-owned public surfaces; vault/inbox usecase consumers now resolve through `@murphai/vault-usecases` and `@murphai/inbox-services`.
- Recurring food auto-log synchronization now crosses the package boundary via explicit hooks instead of a package cycle.
- Direct verification completed with `pnpm typecheck`, `pnpm test:coverage`, `pnpm --dir apps/cloudflare verify`, and `pnpm --dir apps/cloudflare runner:bundle`.
Completed: 2026-04-08
