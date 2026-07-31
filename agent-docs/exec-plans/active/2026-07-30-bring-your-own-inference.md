# Bring your own inference

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Let a personal Murph member use one member-owned OpenAI-compatible endpoint
  for core inference, whether that endpoint exposes Responses or Chat
  Completions.
- Preserve Codex App Server as Murph's only agent runtime and keep endpoint URLs,
  upstream model ids, and credentials out of the runner process.

## Success criteria

- A member can save, replace, inspect, select, and remove one encrypted custom
  inference connection from authenticated Settings.
- Native Responses endpoints stream directly through the existing fenced
  Cloudflare boundary.
- Chat Completions endpoints are translated at that same boundary into the
  Responses lifecycle Codex expects, including tool-call round trips.
- The runner receives only a fixed internal provider, an opaque model alias, and
  an existing platform egress credential; it never receives the custom endpoint
  URL, upstream model id, or API key.
- Custom inference is personal-only, never silently falls back to OpenAI or
  Venice, and is not blocked by Murph-managed model allowance.
- Platform-funded tools retain their existing usage accounting and authority.
- Endpoint, protocol, credential, model, or capability changes start a fresh
  Codex provider thread.
- Focused package, Web, Cloudflare, hosted-runtime, security, migration,
  frontend, design-proof, ReviewGPT, and exact-head CI checks pass.

## Scope

- In scope: one encrypted member-owned connection, Responses and Chat
  Completions protocol support, custom provider selection, current-invocation
  authority, compatibility probing, endpoint policy, usage classification,
  explicit failure behavior, Settings UX, account export/deletion, deployment
  docs, and regression coverage.
- Out of scope: multiple saved connections, arbitrary request headers, private
  network reachability, a device relay, group-owned inference, a second agent
  runtime, and a persistent LiteLLM gateway.

## Constraints

- Web remains the durable owner of member intent and encrypted connection state.
- Codex always speaks Responses; protocol adaptation happens after the existing
  runtime write-fence boundary.
- Reuse the current `web-control.worker` internal provider-fetch route and
  signed Web callback instead of adding another token, Durable Object, queue, or
  credential store.
- The singular connection owns one selection boolean so managed provider, model,
  and reasoning preferences remain untouched. Updating the connection deselects
  it before the verified replacement can be selected.
- Unsupported tools, images, streams, endpoints, and deploy versions fail
  explicitly. No compatibility path may silently reduce Murph's capabilities.

## Risks and mitigations

1. Risk: an older Worker treats an unknown custom provider as no override and
   sends a private turn to OpenAI.
   Mitigation: the workspace reader advertises custom-inference contract version
   1; Web rejects selected-custom reads from older consumers.
2. Risk: a Chat Completions adapter drops Codex custom or shell tools.
   Mitigation: normalize every supported tool shape into deterministic function
   calls, preserve reversible call ids, and reject unknown shapes.
3. Risk: a user-controlled endpoint becomes an SSRF or header-injection path.
   Mitigation: exact HTTPS operation URLs, public DNS hosts, fixed auth kinds,
   zero redirects, stripped authority headers, bounded bodies and streams, and
   repeated policy validation at egress.
4. Risk: replacing a connection changes an active or resumable thread in place.
   Mitigation: connection writes deselect custom inference and revision-derived
   model aliases participate in custom provider continuity.
5. Risk: custom inference bypasses all usage controls.
   Mitigation: only member-funded core inference bypasses the managed model
   allowance; platform-funded tools keep their existing accounting and gates.

## Tasks

1. Land the product contract and shared non-secret protocol types.
2. Add the singular encrypted Web connection, authenticated APIs, migration,
   account export/deletion, and provider selection.
3. Add fail-closed workspace projection and the fixed internal Codex provider.
4. Add the Worker-owned native Responses gateway and compatibility probe.
5. Add the stateless Chat Completions adapter with real Codex tool-loop tests.
6. Split member-funded core inference from platform-funded usage admission.
7. Add Settings and design-catalog surfaces plus direct desktop/mobile proof.
8. Complete focused verification, specialist and final ReviewGPT gates, CI,
   parent review, plan closure, and merge-readiness proof.

## Decisions

- The durable product object is one `HostedInferenceConnection` keyed by member.
- The singular connection's `selected` boolean is the only custom-selection
  fact. Existing managed provider/model/reasoning preferences remain dormant;
  there is no selected-connection foreign key or connection registry.
- Connection create/update verifies the candidate before replacing the current
  row. A failed probe leaves the prior row untouched.
- The fixed Codex provider uses the existing internal Web-control origin and the
  current runtime write fence. No custom endpoint secret enters runner env,
  Codex config, prompt, workspace snapshot, or logs.
- The first Chat adapter is a small Murph-owned TypeScript compatibility module.
  LiteLLM remains a replaceable implementation option only if production-faithful
  tests prove the smaller adapter insufficient.

## Verification

- Focused commands: hosted-execution protocol tests, operator-config provider and
  continuity tests, assistant-runtime Codex config tests, hosted-web connection,
  route, migration, usage, export/deletion, Settings, and design tests, plus
  Cloudflare Worker and real hosted-local Codex protocol scenarios.
- Direct scenarios: native Responses text/tool/final flow, Chat Completions
  text/tool/final flow, endpoint outage without fallback, unsupported image
  rejection, exhausted managed allowance with custom core inference, and
  managed/custom switching.
- Completion: relevant preliminary ReviewGPT lenses, final ReviewGPT gate, green
  exact-head CI, clean merge-base proof, closed plan, and documented rollout and
  rollback floor.
