# PR 770 ReviewGPT Round 1 remediation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

Resolve the first ReviewGPT round on the provider-neutral Labs follow-up with
the smallest durable patch: keep provider identities inside Web, expose only
display-ready Labs facts, qualify the search-retention statement to Murph, and
remove the unrelated changelog expansion from the PR.

## Success criteria

- Member and model-visible Labs responses contain no provider IDs, slugs,
  pagination metadata, or duplicate detail action.
- Catalog search remains bounded and includes the facts needed to render the
  existing expandable details without a second provider request.
- Nearby-location results remain useful without provider site identifiers or
  provider-specific capabilities.
- Labs copy says only that Murph does not save the submitted search terms or ZIP
  codes and does not name the internal provider.
- Public changelog prose and visual labels are provider-neutral while historical
  IDs and tags stay unchanged; no aliases, migrations, or other compatibility
  machinery are added.
- Focused and owner verification, required completion audits, CI, and a valid
  ReviewGPT remediation round pass on the exact pushed head.

## Scope

- In scope: shared Labs request/response contracts, Web provider normalization
  and Labs UI, assistant Labs tool/prompt guidance, public provider-neutral
  changelog copy, focused tests, PR review artifacts, and PR description.
- Out of scope: provider integration ownership, ordering behavior, persistence,
  public changelog changes, deployment, or unrelated refactors.

## Constraints

- Web remains the sole provider credential, egress, and normalization owner.
- Retain strict request bounds, sanitized failures, and discovery-only ordering
  semantics.
- Do not add a masking layer, state owner, compatibility shim, or pagination
  abstraction. Prefer deleting unused contract surface.

## Tasks

1. Finish the response-contract collapse and retain only provider-neutral
   changelog copy changes without changing historical identity.
2. Update focused tests to prove the provider-neutral boundary and preserved
   display behavior.
3. Run required verification and fresh coverage/frontend review passes.
4. Commit and push the exact remediation head, start CI and ReviewGPT Round 2
   concurrently, and address only evidence-backed findings.

## Decisions

- Accept ReviewGPT's privacy wording correction by making the retention claim
  explicitly about Murph, not third-party systems.
- Accept ReviewGPT's complexity finding by deleting the duplicate `show`
  action, public pagination, location lab filtering, and provider identifiers
  instead of adding an adapter or masking layer.
- Accept the changelog identity finding by preserving every historical ID and
  relevance tag. Keep the user-requested provider-neutral displayed copy, and
  narrow the hourly-sync statement to the affected import path instead of
  generalizing it to every connected wearable.

## Verification

- `@murphai/hosted-execution` typecheck + full suite: 366 tests green.
- `@murphai/assistant-engine` typecheck + `test/assistant-labs-tool.test.ts`: 6 tests green.
- `@murphai/cloudflare-runner` typecheck + `test/labs-tool-port.test.ts`: 4 tests green.
- `@murphai/hosted-web` typecheck + the five touched Labs/changelog test files: 51 tests green.
- Repo grep confirms provider identifiers survive only inside the Web provider
  module and rejection tests; the stale `dist/` artifact is ignored build output.
- Changelog net diff vs `origin/main` touches displayed prose and one visual
  label only; every historical ID and relevance tag is byte-identical to main.
- Fresh `coverage-write` and `frontend-review` specialist passes returned clean
  before handoff; ReviewGPT Round 2 runs against the pushed remediation head.
Completed: 2026-07-16
