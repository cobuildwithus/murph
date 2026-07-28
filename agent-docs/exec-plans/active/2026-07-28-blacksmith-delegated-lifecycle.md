# Blacksmith Delegated Lifecycle Repair

## Goal

Restore canonical Crabbox-backed Blacksmith verification by removing the
unsupported generic lifecycle flag from the delegated provider invocation.

## Constraints

- Preserve the pinned Blacksmith provider, organization, ref, workflow, job,
  trusted entrypoint, idle timeout, TTL, and secret-scrubbed environment.
- Keep fresh one-shot behavior: no retained Testbox ID, `--keep`, or
  `--keep-on-failure`.
- Do not forward local environment values or credentials into Blacksmith.
- Keep the correction limited to the dispatcher, its focused contract test, and
  the owning verification documentation.

## Plan

1. Remove only the unsupported `--stop-after always` dispatcher arguments.
2. Make the focused fake-provider test reject that flag and prove the retained
   fresh, non-kept delegated invocation.
3. Document Blacksmith's delegated lifecycle ownership and retained cleanup
   bounds.
4. Run focused and canonical verification, complete ReviewGPT review, and land
   the change through the normal PR lane.

## Verification

- Focused verification-dispatch Vitest coverage.
- `node --check scripts/verification-dispatch.mjs`
- `pnpm test:diff` for the touched tooling, test, and documentation paths.
- Preliminary specialist ReviewGPT and parent final review.

## State

Active. Minimal dispatcher, contract-test, and owner-documentation changes are
implemented. Syntax checks, the 15-test focused contract suite, and canonical
repo-internal `test:diff` (436 tests) pass. PR review is next.
