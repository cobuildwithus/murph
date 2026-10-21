# Retire Worker inference secrets through native version patches

Status: completed
Created: 2026-10-08
Updated: 2026-10-08

## Outcome and invariant

Remove exactly `VENICE_API_KEY` and `VERCEL_AI_API_KEY` from an inactive Worker
candidate through Cloudflare's native version patch. Preserve every retained
secret, synchronized rotation, module, binding and runtime configuration; only
activate after exact secret inventory and source-history checks succeed.

## Current owners and evidence

The existing deployment CLI owns uploads and activation; the release provider
owns bounded authenticated API calls. The secret helper remains a read-only
expected-inventory validator. Official Wrangler commit
`c82d96ba63a3b343b520e781a070889251868d9a` uses a merge PATCH to
`/workers/workers/{name}/versions/latest` with exact null environment entries,
leaving all other version configuration with the server. Its tests forbid
resending keep_bindings, keep_assets, placement and build_options. Local
serialization alone cannot prove that omitted upload bindings are deleted.

## Decisions and scope

- Delete temporary upload config files, unsafe metadata, custom inheritance and
  required-name partitioning. Use the original canonical config with ordinary
  pinned Wrangler upload and its existing synchronized secret payload.
- Derive expected final names/types from the original live inventory plus the
  payload, excluding only the two retired names. Validate canonical required
  names against that expected inventory without rewriting configuration.
- Keep upload history checks. Patch only when the uploaded inventory contains
  a retired key; require latest to equal that exact upload immediately before
  patching and the resulting newest pair to equal patched/uploaded afterwards.
- Carry the deployment tag/message into the patch. Reject null, malformed or
  unchanged result IDs. Validate the complete final secret inventory before
  native changes, smoke and activation; return the patched ID to existing owners.
- Preserve stage/final source chaining and worker-only publication. No inactive
  version adoption, recovery machine, new dependency, operator input or workflow.
- The protected serialized owner remains authoritative. History checks detect
  drift, not atomic compare-and-swap. A failed operation can leave an inactive
  version; operational resolution remains separate and explicitly owned.

## Tasks

1. Replace custom upload preparation with native patching at existing owners.
2. Prove exact request/body/result semantics, no-op and failure behavior, retained
   optional/crypto secrets, rotations, history drift and both rollout shapes.
3. Replace obsolete config-reconstruction tests, update the durable deployment
   contract and reuse the existing public-safe serialization-gap Frog record.
4. Run focused tests, Cloudflare typecheck, complexity and docs checks; inspect
   the diff, close this plan, commit and push a draft PR for parent completion.

## Verification

- Passed 176 focused tests across secret inventory, deployment CLI and release
  provider suites. Real pinned Wrangler dry-runs cover ordinary serialization
  with disabled, empty, partial and full synchronized payloads.
- Passed Cloudflare typecheck, docs drift and the complexity guard. No changed
  source function exceeds the complexity threshold; deployment CLI maximum is
  13, secret helper 19 and provider 20.
- Parent reviewed source, tests, docs and the reused Frog entry with no blocking
  findings. The fetched base merges cleanly; diff and privacy checks passed.
- Provider-shaped tests prove the PATCH wire contract and fail-closed ordering;
  protected external acceptance and exact-head CI remain with the parent after
  final review and merge. No production call or secret-value access occurred.

## Handoff boundary

Internal deployment tooling only: no member-facing UX or changelog item. Parent
owns final review, ReviewGPT, exact-head CI, merge, production cleanup/recovery
and deployment. This task performs no external mutation or secret-value access.
Completed: 2026-10-08
