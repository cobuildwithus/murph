# ReviewGPT connector default

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Make Murph's default `review:gpt` flow use the ChatGPT GitHub connector plus the Murph GitHub repo URL, without generating or attaching ZIP/repomix review bundles.
- Patch and publish `@cobuild/review-gpt` first if the current package does not support connector-only/no-artifact staging.

## Success criteria

- `@cobuild/review-gpt` exposes an explicit no-artifacts/no-ZIP mode, with README/help/tests aligned, and a new patch release is published.
- Murph and sibling consumer repos depend on the released package version.
- Murph `scripts/review-gpt.config.sh` disables artifacts by default while keeping `app_connector="github"` and the Murph repo URL.
- Murph's standalone `zip:src` scripts continue to use the guarded audit packager.

## Scope

- In scope: sibling `../review-gpt` package CLI/config/docs/tests/release, Murph review-gpt config, dependency metadata, sibling consumer dependency metadata, focused release-audit tests.
- Out of scope: changing Murph audit packagers, research workflows, or ChatGPT thread wake/download behavior.

## Constraints

- Technical constraints: preserve existing review-gpt behavior for repos that do not opt out of artifacts; avoid printing or writing local home/user identifiers.
- Product/process constraints: use `scripts/committer`/release tooling in `../review-gpt`; use Murph plan completion tooling for the Murph commit.

## Risks and mitigations

1. Risk: connector-only reviews miss uncommitted local changes that the ZIP bundle used to include.
   Mitigation: make no-artifact mode explicit and keep standalone packaging commands available for intentional artifact-based reviews.
2. Risk: consuming repos that expect ZIP artifacts break.
   Mitigation: keep artifact attachment as the upstream default and opt Murph out in config only.

## Tasks

1. Patch `../review-gpt` no-artifacts/no-ZIP support.
2. Verify and publish the `@cobuild/review-gpt` patch.
3. Update Murph config/dependency/tests to consume the release and default to connector-only context.
4. Update sibling consumer repos to consume the released package.
5. Run scoped Murph verification and completion review.
6. Commit the Murph task with `scripts/finish-task`.

## Decisions

- Use a general `attach_artifacts=0` config knob with `--no-artifacts`/`--no-zip` CLI aliases instead of a Murph-only wrapper.
- Keep artifact attachment as the upstream default; Murph-family repos opt out through config, while other consumers only receive the package bump.

## Verification

- Commands to run:
  - `../review-gpt`: `pnpm typecheck`, `pnpm test`, release command checks.
  - Murph: `pnpm typecheck`, direct `review:gpt --dry-run` check, focused release audit test.
- Sibling consumers: package-manager install/lockfile verification for `@cobuild/review-gpt@0.5.90`; broader repo checks as time and dirty worktree state allow.
- Expected outcomes: all required checks pass; dry-run reports artifacts disabled and GitHub connector/repo context enabled.
Completed: 2026-05-27
