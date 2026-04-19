# Batch 2 / Agent 10

Implement the greenfield Cloudflare deploy/config/lifecycle cleanup.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final surviving deploy/runtime env surface, removed config/docs/lifecycle entries, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/cloudflare/scripts/**`
- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/DEPLOY.md`
- `apps/cloudflare/README.md`
- `apps/cloudflare/r2-bundles-lifecycle.json`

Do not modify outside those paths.

Target architecture:

- deploy/config/docs describe a narrow execution plane only
- deleted Cloudflare owners do not linger in secrets/env/docs/lifecycle rules/smoke checks
- ciphertext storage remains supported, but broad control-plane/state-owner language is gone

Required changes:

1. Remove deploy/config references to deleted control routes and deleted durable owners.
2. Tighten the documented required/optional env vars and secrets so they match the narrowed execution plane.
3. Update bucket lifecycle rules so removed transient stores/prefixes are no longer treated as first-class durable seams.
4. Update smoke/deploy helpers to validate the surviving routes and execution outcomes only.
5. Keep encrypted workspace/artifact/blob documentation accurate.
6. Remove rollout/history language that implies Cloudflare still owns product/control facts.

Implementation style:

- Prefer a shorter, sharper deploy surface.
- Delete dead knobs.
- Keep docs aligned with runtime reality, not historical scaffolding.
