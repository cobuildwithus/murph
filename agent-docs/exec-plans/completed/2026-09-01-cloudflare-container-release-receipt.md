# Cloudflare container release receipt

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make the existing Cloudflare Worker deploy owner emit one ephemeral, secret-safe
  receipt that proves which rendered container applications were created,
  updated, or unchanged by the exact Wrangler deploy and binds that result to
  the requested Worker tag and final Worker version.

## Success criteria

- The provider boundary captures every rendered container application
  immediately before and after the existing Wrangler command.
- Each receipt entry contains only application name, class name, an exact
  created/updated/unchanged disposition, a positive provider application
  version, and a SHA-256 digest of the exact provider image reference.
- Missing-to-present is created, exact identity equality is unchanged, and only
  a same-application single-version advance is updated; every other transition
  fails closed.
- The deployment result JSON and `GITHUB_OUTPUT` both expose exactly one
  `container_release_receipt` bound to the exact deploy tag and final Worker
  version id.
- Focused tests cover valid transitions, malformed/duplicate/missing provider
  state, ambiguous transitions, output publication, env-tag propagation, and
  exactly one Wrangler `--tag` argument.

## Scope

- In scope: the existing Cloudflare deploy CLI/shared owner, one small
  provider-boundary helper, and focused deploy tests.
- Out of scope: persistent state, services, tables, manifests, schedulers,
  rollout polling, private-repository workflow changes, and live deployment.

## Constraints

- Technical constraints: reuse the generated Wrangler config; never emit raw
  account ids, API tokens, provider image references, or raw provider errors;
  keep the receipt deterministic and single-line-safe for `GITHUB_OUTPUT`.
- Product/process constraints: preserve the existing deploy owner and Wrangler
  invocation, keep complexity local to the provider boundary, work only in the
  sanctioned task worktree, and do not push or open a PR.

## Risks and mitigations

1. Risk: provider application state is eventually consistent or ambiguous.
   Mitigation: observe both sides of the actual Wrangler command and fail closed
   unless the transition is exactly created, unchanged, or a monotonic update.
2. Risk: a diagnostic receipt leaks provider image or account identity.
   Mitigation: hash the exact image reference in memory and keep provider errors
   generic; expose no raw account or image field.
3. Risk: the Worker tag used by Wrangler diverges from the receipt.
   Mitigation: carry one resolved tag through `deployDirect`, assert an exact
   env-derived sentinel, and prove the CLI contains exactly one `--tag` pair.

## Tasks

1. Inspect the current deploy owner, generated-config contract, provider API
   semantics, and focused verification owners.
2. Add the provider-boundary helper and integrate its transition result with the
   existing deployment result and GitHub outputs.
3. Add focused unit and CLI proofs for transition classification, provider
   parsing, outputs, and exact tag propagation.
4. Run focused Cloudflare typecheck/tests, inspect privacy-safe diff and
   complexity, then archive the plan and create the scoped commit.

## Decisions

- Use Cloudflare's filtered container-application list endpoint because Wrangler
  4.90 consumes the same full application records and it yields id, version,
  and exact image reference without another state owner.
- Keep raw application ids and image references inside the provider helper;
  return only the requested public-safe transition fields.
- Require an updated application to advance exactly one provider version so a
  concurrent or unrelated mutation cannot be attributed to this deploy.

## Verification

- Focused Cloudflare deploy/receipt Vitest: 89 tests passed.
- Full `apps/cloudflare` verification: 153 node test files / 2,815 tests plus
  six container-helper tests and six Worker test files / 15 tests passed.
- App-local typecheck, cyclomatic-complexity diff, and `git diff --check` passed.
- Independent remediation review passed after binding the receipt to Wrangler's
  exact Worker version and documenting the public/private release order.
Completed: 2026-09-01
