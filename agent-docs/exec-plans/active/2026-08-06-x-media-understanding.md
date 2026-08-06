# X media understanding

Status: active
Created: 2026-08-06
Updated: 2026-08-06

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

1. Update the fixed worktree disk floor, tests, and workflow documentation.
2. Enable image and video understanding in `ask_grok` and clarify its tool contract.
3. Extend the hosted xAI request validator and focused tests.
4. Update durable security documentation and the product changelog.
5. Run focused proof, review the diff, commit, push, open a PR, and complete required review and CI gates.

## Decisions

- Reuse `ask_grok`; do not add a media-specific tool or provider.
- Enable both media capabilities on the existing X search request.
- Use a fixed 20 GiB worktree disk floor and remove percentage configuration.

## Verification

- Commands to run: focused Vitest files for `ask_grok`, Cloudflare xAI egress, and worktree storage guard; targeted typechecks if the changed graph requires them.
- Expected outcomes: exact media flags pass, malformed flags fail closed, the 20 GiB boundary is enforced, and no unrelated behavior changes.
