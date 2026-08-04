# Bring Your Own Inference

Status: specified
Last verified: 2026-08-03

## Outcome

A personal Murph member may use one member-owned OpenAI-compatible endpoint for
core replies. The endpoint may expose either the OpenAI Responses API or Chat
Completions API. Murph keeps Codex App Server as its only agent runtime and
normalizes both upstream protocols into the Responses lifecycle Codex already
uses.

## Product contract

- Managed inference remains the default.
- A member may save one custom inference connection in authenticated Settings.
- Saving a connection does not select it automatically.
- Selecting **Your endpoint** affects the next bounded provider turn. A turn
  already admitted under another provider may finish under that provider.
- Updating or removing the saved connection first returns the member to managed
  inference. The member explicitly selects the replacement after it verifies.
- A custom endpoint failure never sends the same turn to OpenAI, Venice, or
  another endpoint.
- Custom inference is available only in the member's private Murph. Group-room
  runtimes never inherit a participant's endpoint.
- Murph does not claim that an OpenAI-shaped route is compatible merely because
  it returns text. The candidate must pass streaming and tool-loop checks.
- A text-only endpoint rejects image-bearing turns explicitly. Murph does not
  silently remove the image or use a managed vision model.
- Custom core inference is member-funded and does not consume managed model
  allowance. Platform-funded tools remain separately metered and authorized.

## Settings

The existing Assistant settings section keeps one provider control for where
new core replies go. Its provider dialog presents OpenAI, Venice when operator
configuration makes it available, and **Your endpoint** as peers. Choosing
**Your endpoint** opens connection setup and management in that same dialog.
Luna, Terra, and Sol remain the saved model choice for managed inference.

The connection form asks for:

- protocol: Responses or Chat Completions;
- exact HTTPS operation URL;
- upstream model id;
- authentication: bearer, `api-key`, or `x-api-key`;
- configured context-window size; and
- whether the endpoint accepts image input.

Before save, Settings says that Murph will send relevant conversation context,
tool descriptions, and supported attachments to that endpoint while selected.
The saved secret is never displayed again; the member can replace it.

The safe summary displays only protocol, endpoint host, model id, configured
context, image availability, revision, and verification time.

## Durable state

There is exactly one `HostedInferenceConnection` per personal member. It is
keyed by `memberId` and stores:

- protocol;
- one encrypted versioned configuration containing exact endpoint URL, upstream
  model id, auth kind, and secret;
- monotonic revision;
- configured context-window size;
- image-support declaration;
- compatibility profile;
- verification time; and
- one selection boolean.

The selection boolean lives on the singular connection so the existing managed
OpenAI/Venice, model, and reasoning preferences remain dormant and unchanged.
There is no connection id, selected-connection foreign key, provider registry,
status machine, verification queue, retry row, or Cloudflare copy of durable
connection state. Replacing the connection deselects it until the member
explicitly selects the verified replacement.

A runtime-relevant connection edit increments the revision. The revision-derived
internal model alias participates in custom-provider thread compatibility, so an
edited endpoint, model, protocol, credential, context, or image policy cannot
reuse the old provider thread.

## Ownership and data flow

1. Web verifies, encrypts, and stores the singular member-owned connection.
2. Web projects only bounded custom metadata in the signed workspace response.
3. During invocation preparation, Cloudflare resolves the exact selected
   revision once through the existing signed Web callback.
4. Cloudflare revalidates endpoint policy, seals the target under a
   context-separated Worker key, and binds the envelope to the existing active
   UserRunner write fence beside workspace version and platform-usage authority.
5. Cloudflare launches Codex with one fixed internal provider, a
   revision-derived model alias, and a public non-secret sentinel.
6. Codex sends Responses requests to the fixed custom-inference internal
   origin. Existing provider fetch attaches only the current opaque
   provider-egress authority.
7. Cloudflare validates that authority against the active fence, opens the
   pinned envelope, rewrites model/auth, and streams the result through the
   selected protocol adapter.

The endpoint URL, upstream model id, and API secret never enter runner env,
Codex config, prompts, workspace snapshots, or operational logs.

## Protocol boundary

Codex always sees `wire_api = "responses"`.

### Native Responses

Cloudflare forwards one normalized `POST .../responses` request directly to the
member endpoint and normalizes the returned Responses stream. Native Responses
traffic does not pass through the Chat adapter.

### Chat Completions

Cloudflare converts the normalized Responses request into Chat Completions,
streams the upstream completion, and emits the Responses events Codex expects.
The adapter is stateless and request-local. It owns no connection records,
credentials, routing, billing, retries, fallbacks, or response history.

Murph normalizes every supported Codex function, namespace, custom, and shell
tool shape into deterministic standard function calls before Chat translation.
The mapping is reversible from the request history and call ids. An unknown or
unrepresentable required tool fails explicitly; no tool is silently dropped.

LiteLLM is not a product owner or required gateway. It may replace the small
adapter later only if a production-faithful failing test proves the current
translation insufficient.

## Endpoint policy

Initial hosted support is public HTTPS only. The exact operation URL must:

- use HTTPS on port 443;
- use a DNS hostname rather than an IP literal;
- have no URL username, password, or fragment;
- end in `/responses` or `/chat/completions` for the selected protocol;
- contain no query parameters except a bounded `api-version` value; and
- not target localhost, `.local`, private/link-local/metadata networks, Murph
  origins, or Cloudflare internal synthetic hosts.

Cloudflare follows zero redirects, strips caller authority and forwarding
headers, injects exactly one configured auth header, and bounds request bytes,
response errors, SSE events, idle time, total duration, and retries.

A user running a local model must expose it through an authenticated public HTTPS
route, such as an outbound tunnel. Private-network and device-relay transports
are future additions to this same connection object, not part of this release.

## Compatibility profile

A candidate is persisted only after synthetic verification succeeds through the
same Cloudflare protocol code used at runtime. Verification uses no member
conversation, vault, health record, or attachment.

The profile proves:

- streamed text;
- one function call;
- matching tool output;
- a final response after the tool output;
- bounded transport and error behavior; and
- image input when image support is declared.

The configured context window is bounded and labeled as configured, not fully
proven by the short probe. CI and deploy smoke exercise context and local
compaction against the exact pinned Codex build.

## Failure and recovery

- Invalid candidate: preserve the prior saved connection unchanged.
- Endpoint unavailable or malformed: fail the current custom provider attempt
  with fixed safe copy and no managed fallback.
- Unsupported image/tool/stream: reject before any misleading partial answer.
- Scheduled automation: use the selected endpoint and the existing bounded retry
  lifecycle; never substitute another provider.
- Deployment skew: a selected custom workspace is returned only to a Worker that
  advertises custom-inference contract version 1. Older consumers receive a hard
  incompatibility response rather than managed defaults.
- Rollback: disable new custom selection first, return selected members to
  managed inference explicitly, then roll back Worker/runner support.

## Privacy, export, and deletion

The authenticated Settings reader returns the selected mode, protocol,
sanitized host, model id, configured context, image declaration, revision,
compatibility profile, and verification time. The current Data & Privacy
download remains a browser-vault export and deliberately omits the database
connection row. Neither surface includes the API secret, ciphertext, full query
string, internal alias, or raw provider errors.

Account deletion explicitly removes the connection row before deleting the
member; relation cascade remains a safety net. There is no upstream vendor
cleanup because the endpoint and account are member-owned. Deleting the member
also clears the existing UserRunner state that can hold an invocation-scoped
encrypted target envelope.

## Non-goals

This release does not add:

- Chat Completions to Codex configuration;
- a second assistant runtime;
- multiple saved endpoints;
- provider-specific GLM, Ollama, vLLM, OpenRouter, or model branches;
- a persistent LiteLLM control plane;
- a custom-inference Durable Object, queue, or status machine;
- arbitrary custom headers or private-network access;
- group-owned custom inference; or
- silent managed, image, or tool fallback.
