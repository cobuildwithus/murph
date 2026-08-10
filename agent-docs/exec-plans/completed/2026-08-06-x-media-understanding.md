# X media understanding

Status: completed
Created: 2026-08-06
Updated: 2026-08-10

## Goal

- Let Murph inspect images and videos in public X posts through the existing `ask_grok` path.
- Replace the percentage-based worktree disk floor with the existing fixed 20 GiB floor.

## Success criteria

- `ask_grok` enables xAI image and X video understanding without adding a provider or tool.
- Hosted xAI egress accepts only the two documented boolean media flags.
- Existing call limits, storage disablement, untrusted-result framing, and exact-cost accounting remain unchanged.
- The worktree guard enforces 20 GiB free space without a percentage condition.
- Focused tests cover accepted and rejected request shapes and the fixed disk floor.
- `/changelog` describes X image and video understanding.

## Scope

- In scope: assistant tool request and description, Cloudflare xAI request validation, focused tests, durable security/workflow docs, and changelog content.
- Out of scope: ScrapeCreators, raw media download or storage, authenticated/private X access, new tools, and new dependencies.

## Constraints

- Technical constraints: reuse the existing xAI Responses request, Worker credential boundary, per-turn call ceiling, and usage accounting.
- Product/process constraints: keep the behavior explicit about third-party claims and do not present an X post as medical proof.

## Risks and mitigations

1. Risk: media flags widen the provider request surface.
   Mitigation: allow only exact booleans on the sole `x_search` tool entry and reject other values or keys.
2. Risk: Worker and warm runner versions deploy out of order.
   Mitigation: document the required deployment order and preserve clear fail-closed behavior during skew.
3. Risk: visual analysis adds provider cost.
   Mitigation: retain the existing call ceiling and exact provider-cost accounting.

## Tasks

1. [x] Update the fixed worktree disk floor, tests, and workflow documentation.
2. [x] Enable image and video understanding in `ask_grok` and clarify its tool contract.
3. [x] Extend the hosted xAI request validator and focused tests.
4. [x] Update durable security documentation and the product changelog.
5. [x] Run focused proof, review the diff, commit, push, open a PR, and complete required review and CI gates.

## Decisions

- Reuse `ask_grok`; do not add a media-specific tool or provider.
- Enable both media capabilities on the existing X search request.
- Use a fixed 20 GiB worktree disk floor and remove percentage configuration.

## Verification

- Assistant `ask_grok` Vitest: 21 passed.
- Cloudflare xAI interceptor Vitest: 238 passed.
- Worktree storage guard Vitest: 22 passed.
- Changelog registry and page Vitest: 34 passed.
- Assistant Engine, Cloudflare, and prepared Web typechecks passed.
- ReviewGPT final Round 3 passed on commit `7b52f6b4946217046d8bd5da7868b54358029ecd`.
- Required GitHub Actions passed on the same commit. The optional live Stripe matrix was skipped by its workflow.
- Parent diff review found no remaining correctness, security, simplicity, or product-flow issue.
Completed: 2026-08-10
