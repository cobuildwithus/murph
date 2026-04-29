# review-gpt-protocol-packaging

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- Add a target-aware Review GPT protocol command so a caller can pass a Health Commons protocol slug and upload only the protocol-relevant context instead of the whole Health Commons corpus.

## Success criteria

- `pnpm review:gpt:protocol finnish-sauna --dry-run` resolves to a focused Review GPT run using the Finnish sauna protocol slug.
- The reusable packaging script accepts a protocol slug and produces a zip containing the target protocol, related Health Commons content, source notes, appraisals, and relevant research reducer/synthesis artifacts.
- The focused package omits unrelated Health Commons source corpora, generated catalog output, and broad active-plan noise.
- Existing broad `review:gpt:protocol` behavior remains available.

## Scope

- In scope: root npm scripts, Review GPT config/package wrapper scripts, and focused repo-tooling tests.
- Out of scope: changing Health Commons protocol content, changing Review GPT browser automation, or sending a Pro request.

## Constraints

- Technical constraints: preserve generic audit packaging; do not include raw `.env`/secret material; keep output-package inclusion narrowly bounded to selected research artifacts.
- Product/process constraints: keep the command path simple for protocol-edit prompts and avoid personal identifiers in generated files or docs.

## Risks and mitigations

1. Risk: A target package still includes too much unrelated Health Commons content.
   Mitigation: Resolve protocol/family/source roots from the target slug and test for excluded unrelated source directories.
2. Risk: The command shape does not forward Review GPT args correctly.
   Mitigation: Implement a small wrapper that consumes the slug first, exports the target env, then delegates to the existing profile/config path.

## Tasks

1. Inspect existing package scripts and tests.
2. Add the slug-targeted package wrapper and Review GPT command wrapper.
3. Add/adjust focused tests for archive contents and command wiring.
4. Run repo-tooling/typecheck verification.

## Decisions

- Make `review:gpt:protocol` the target-aware slug command and preserve the old broad package as `review:gpt:protocol:all`.

## Verification

- Commands to run: `pnpm test:repo-tools`, `pnpm typecheck`, `git diff --check`.
- Expected outcomes: repo-tooling tests cover package contents, typecheck remains green or reports unrelated active-tree failures, and diff check passes.
Completed: 2026-04-30
