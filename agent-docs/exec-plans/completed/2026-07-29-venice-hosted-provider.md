# Venice Hosted Model Provider

## Outcome

Hosted members can choose OpenAI or Venice as the model provider in Settings.
The selected provider is persisted by Web, projected into the next hosted
invocation, and enforced by the Worker-owned provider egress boundary without
placing either upstream API key in the runner container.

The public FAQ and security page describe the choice in plain language without
claiming stronger privacy guarantees than the implementation proves.

## Invariants

- OpenAI remains the default when no provider preference is stored.
- Web owns the member preference and projects only a bounded provider slug.
- Cloudflare owns upstream credentials and injects them only after validating
  the runner-scoped provider credential and active invocation fence.
- The runner never receives raw OpenAI or Venice API keys.
- A provider preference change affects future invocation configuration; it does
  not silently rewrite unrelated billing, plan, group, or model preferences.
- Unsupported provider values fail closed at every trust boundary.

## Owners And Data Flow

1. `apps/web` stores and validates the member provider preference.
2. `packages/hosted-execution` carries the bounded provider slug in the
   workspace invocation contract.
3. `packages/assistant-runtime` translates that slug into the hosted Codex
   provider configuration expected by the runner.
4. `apps/cloudflare` authorizes the active runner and injects the matching
   Worker-owned upstream credential at outbound egress.
5. The generated Cloudflare deployment contract keeps OpenAI required and
   requires the Venice secret plus all three fixed product-model mappings
   together whenever Venice is configured.

## Failure, Retry, And Deployment

- Missing or invalid provider configuration fails before model execution.
- Provider requests reuse the existing bounded runtime and provider-attempt
  behavior; this change adds no queue or retry owner.
- Apply the nullable Web migration and deploy the compatible Web reader with
  `HOSTED_VENICE_ENABLED` off before Cloudflare. Deploy Cloudflare with the
  Venice secret and fixed model mappings, verify one controlled turn, and only
  then enable the Web flag and redeploy to expose the choice.
- Cloudflare requires immediate container rollout because the runtime
  configuration and provider-egress contract change together.
- Rollback disables the Web flag first so new workspace reads project OpenAI,
  then removes Venice configuration or rolls back Cloudflare.

## Proof

- Focused Web, hosted-execution, assistant-runtime, Cloudflare egress, generated
  deploy-config, and workflow-secret regression tests.
- Canonical `pnpm test:diff` for every touched owner and
  `pnpm verify:acceptance`.
- Design-catalog desktop and mobile proof for Settings and the public content.
- Product-experience review, preliminary completion-specialists ReviewGPT,
  parent review, and final ReviewGPT exact-head gate.
- Required GitHub CI, mergeability proof, merge, deployment-status checks, and
  worktree retirement.

## Progress

- [x] Confirmed the supplied patch is absent from current `origin/main`.
- [x] Created an isolated task worktree from current `origin/main`.
- [x] Reconcile the supplied patch with current owners and contracts.
- [x] Add public FAQ, security-page, and design-catalog copy.
- [x] Resolve product-experience findings and prove flag-off and flag-on public
  journeys at desktop and mobile sizes.
- [x] Complete local verification and rendered evidence.
- [x] Resolve the preliminary ReviewGPT findings, complete the parent review,
  rerun the affected focused checks, and push the reviewed implementation.
- [x] Hand the closed implementation plan to the required post-closure final
  ReviewGPT, exact-head CI, merge, deployment-status, and retirement gates.
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
