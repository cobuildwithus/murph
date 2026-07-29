# Group Chat Speaker Name File Cache

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Land the returned Pro patch that replaces assistant-runtime's resident
  cross-operation Linq speaker-label cache with a bounded private file cache.

## Success criteria

- Valid Linq group speaker labels and valid unnamed results reuse across fresh
  reader/process instances that share one local workspace.
- Cache entries stay scoped by runtime member, route conversation, channel, and
  normalized handle without persisting raw handles, route ids, member ids, or
  labels in filenames or keys.
- Failures, malformed responses, corrupt state, and expired state fail soft and
  do not become durable authority.
- Focused tests and repo-required verification pass.

## Scope

- In scope: assistant-runtime speaker-label reader, its phase wiring, focused
  tests, and durable architecture/security/reliability/testing docs.
- Out of scope: Web label authority, migrations, distributed locks, queues,
  timers, resident cross-operation caches, and unrelated group-chat behavior.

## Constraints

- Keep Web as the sole membership/profile/contact authority.
- Keep the cache private, bounded, optional, presentation-only, and excluded
  from hosted workspace checkpoints.
- Preserve direct one-to-one and Telegram behavior.
- Apply only the retained Pro response and downloaded patch intent.

## Risks and mitigations

1. Risk: persisted presentation residue becomes identity or effect authority.
   Mitigation: store only opaque scoped keys and labels/provenance for prompt
   presentation; participant effects still require accepted message refs.
2. Risk: stale labels linger too long or cross scope.
   Mitigation: fixed short TTLs and key derivation over runtime member, exact
   route conversation, channel, and normalized handle.
3. Risk: cache file corruption blocks replies.
   Mitigation: treat unreadable/corrupt/oversized state as a cache miss and
   repair only after a valid Web response.

## Tasks

1. Apply and inspect the returned patch.
2. Verify helper API boundaries and privacy invariants.
3. Run focused and repo-required verification.
4. Close this plan with the scoped landing commit.

## Verification

- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-group-shared-reader.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm test:diff packages/assistant-runtime/src/hosted-runtime/group-shared-reader.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-group-shared-reader.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts ARCHITECTURE.md agent-docs/RELIABILITY.md agent-docs/SECURITY.md agent-docs/index.md agent-docs/references/hosted-runtime-protocol.md agent-docs/references/testing-ci-map.md`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm test:scenario-integrity`
- `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm docs:drift`
Completed: 2026-07-29
