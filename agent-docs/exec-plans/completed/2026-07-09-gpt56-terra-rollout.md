# GPT-5.6 Terra Rollout

## Goal

Make the hosted assistant ready for an environment-only switch to
`gpt-5.6-terra` while preserving Flex processing for hosted cron turns.

Success means:

- production deploy preflight accepts `HOSTED_ASSISTANT_MODEL=gpt-5.6-terra`
  with the existing low-reasoning production profile and immediate container
  rollout;
- the hosted runner uses Codex's native GPT-5.6 catalog entries and adds the
  existing Flex tier without replacing official model metadata;
- GPT-5.6 standard and Flex allowance pricing uses current official OpenAI
  pricing evidence and remains fail-closed on provider/model proof;
- the post-deploy live model smoke invokes `gpt-5.6-terra` through the real
  hosted OpenAI path;
- focused tests, typecheck, Cloudflare deployment checks, PR review, and CI pass.

## Constraints

- Keep the global hosted model environment-owned; do not add another runtime
  model default or deployment state owner.
- Preserve the existing bounded cron Flex timeout and standard-tier retry path.
- Keep managed automation model selection unchanged.
- Do not expose secrets or personal identifiers in artifacts or logs.
- Preserve `gpt-5.5` as the documented rollback floor.

## Plan

1. Use the native Codex 0.144 GPT-5.6 catalog and add Flex tier metadata.
2. Replace preview-era GPT-5.6 pricing metadata with current official pricing
   evidence without changing verified rates.
3. Update Cloudflare deployment documentation, preflight wording, and the live
   post-deploy smoke for the Terra rollout.
4. Add focused regression coverage for pricing, preflight, native catalog
   support, and the live Terra turn.
5. Run scoped verification, commit with `scripts/finish-task`, open a PR, and
   complete the PR ReviewGPT and CI gates.

## Verification

- focused web hosted-usage allowance tests
- focused Cloudflare deploy, catalog, and smoke tests
- `pnpm typecheck`
- `pnpm test:diff <changed paths>`
- secret-free Cloudflare deploy preflight/config/artifact validation where the
  repository harness supplies fixtures

## State

- Official OpenAI docs confirm `gpt-5.6-terra` model ID, Responses API support,
  reasoning controls, and standard/Flex pricing.
- Codex 0.144 includes native GPT-5.6 Sol, Terra, and Luna catalog entries.
- Existing runtime, deploy-preflight, and allowance primitives already recognize
  the GPT-5.6 family.
- The runner now preserves Codex's native GPT-5.6 metadata, adds Flex
  idempotently, and fails image validation if any required entry is missing.
- The production deploy smoke targets Terra through the real Worker-owned
  OpenAI egress path, and the staged rollout/rollback sequence is documented.
- Focused tests, native catalog execution, full workspace typecheck, and the
  Cloudflare/web diff-aware verification lanes passed.
- Implementation is complete and ready for the PR review loop.

Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
