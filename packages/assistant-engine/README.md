# @murphai/assistant-engine

Workspace-private headless assistant execution runtime for Murph.

This package owns headless assistant execution and assistant-specific tool surfaces. That includes the assistant turn runtime, Codex app-server provider execution path, direct CLI prompt/bootstrap guidance, assistant state/outbox/status/store surfaces, assistant automation, and input/tool integration points for the daemon and hosted runtimes.

Neutral vault services live in `@murphai/vault-usecases/vault-services`, and inbox service composition lives in `@murphai/inbox-services`. `assistant-engine` consumes those owners instead of owning their factories. Canonical writes still terminate in `packages/core`. Provider-target normalization plus hosted provider preset/config utilities are owned by `@murphai/operator-config` and consumed here directly.

## Prompt time context

Inbound auto-reply prompts render occurrence instants before provider execution.
Each occurrence includes the local clock derived from the vault's canonical IANA
timezone and the original UTC instant. Provider models must not be asked to
convert or relabel a bare UTC clock from separately supplied timezone context.
The thread-stable prompt also forbids relabeling `Z` or offset timestamps as
local clock values when a tool or older context exposes an exact instant.
If vault metadata cannot be read or does not contain a valid canonical zone,
prompt construction renders the exact UTC instant only. The runtime timezone
may still support internal date planning, but it is never labeled as the
member's local timezone.

## Codex Warmth

Codex app-server turns use one warm process for the full lifetime of a warm Node
runtime/container. A turn is an RPC into that process rather than a per-turn
app-server subprocess. Overlapping turns fail busy instead of spawning parallel
app-server processes.

Process launch identity contains only process-stable settings such as the
command, args, stable working directory, Codex home, and sanitized stable env.
Prompts, session/thread/turn ids, delivery routes, invocation credentials, and
route or device grants are request facts. They do not enter launch identity or
the App Server child env, so an ordinary later turn cannot replace the process.

Per-thread settings such as model, model provider, approval policy, sandbox,
and cwd are sent through thread RPC. Native resume validates Codex's returned
thread context before starting a turn; if the resume path is stale, the provider
starts a fresh thread for the same user turn instead of failing to reply.
Provider-table authority should be passed as explicit `--config` process args
by the provider path; those args are already part of launch identity.

Codex accepts dynamic tools on `thread/start`, persists them in rollout session
metadata, and restores them when a cold `thread/resume` does not provide a new
tool list. Murph therefore keeps native thread continuity across a genuine cold
restart instead of reconstructing a bounded transcript as a new thread. This
applies to every registered dynamic tool, including the private
`murph.assistant_style` surface; no tool-specific stale-resume fallback is
needed.

Scheduled automation occurrences use this same ordinary turn path. The saved
automation instructions become the turn request; schedule occurrence and
delivery facts are trusted dynamic context, while the structured send-or-skip
object is only an outbox delivery envelope. There is no scheduled prompt
profile, tool profile, planner, thread policy, skill surface, or assistant stack.
The ordinary invocation context and effect-owner checks determine which tools
are usable.

Detached `assistant.notification.requested` system events are a different kind
of input, not a scheduled-turn profile. Without a valid occurrence they use one
isolated output-only formatter with no history, private context, resume
mutation, tools, or network callbacks; the platform still owns delivery. The
formatter uses a fresh ephemeral thread on the resident App Server. Its
thread-local deny configuration does not change the ordinary process launch
identity or persist a resumable notification thread.

An authenticated current-sender private Assistant Ask completion is the narrow
deterministic exception. It starts no formatter or provider turn and does not
mutate the member's ordinary conversation when the notification is queued.
Only after the hosted outbox reaches canonical `sent` does the hosted runtime
import the exact reviewed assistant text into the exact ordinary direct session
returned by the queue-time hosted-default continuity lookup. Compatible model
or reasoning changes preserve that binding. If no ordinary session existed,
the intent remains unbound until the first canonical attended direct turn;
another same-route detached session is never inferred as the owner. The import
advances that session once and clears its
stale native provider-resume aliases. The outbox intent journals an interrupted
import, and nested hosted direct route plus accepted assistant-input authority
repairs it before provider-resume selection even for text-only payloads.
An ordinary direct scheduled occurrence also repairs an exact session-bound
obligation before provider-resume selection, but cannot claim unbound work;
that remains reserved for the first attended direct turn.
The direct output-only Assistant Ask continuation uses that same bound-only
admission before provider planning. Rejected completions, unrelated-session
continuations, and every generic detached notification remain isolated and
cannot claim this continuity behavior.
An outbox intent written before the explicit continuity binding existed fails
closed instead of inferring an owner. Partial or ambiguous provider receipts do
not participate, even when they preserve message metadata for transport retry.
A current canonically sent continuity
obligation remains exempt from terminal outbox pruning until its journal is
applied; applied intents return to ordinary terminal retention.

The `creative-response` and `creative-response-text` notification prompt
profiles are isolated system continuations for verified, explicitly requested
social moments. Both prompts are built only from the engine-supplied task and
bounded committed conversation history. Message and poem requests use an
output-only turn profile with no tools. Song format projects only
`generate_song`, the sole format-specific tool, and requires exactly one call
with `durationSeconds: 15`. The application-owned song tool retains the bound
provider transport plus the existing authority-free public transport required
for a validated signed Linq upload; those transports are not native Codex
browsing capabilities. The ordinary response-media and outbox owners remain
unchanged. Named style references are reduced to broad musical traits rather
than copied melody, lyrics, catchphrases, vocal identity, or signature
arrangement. A creative provider failure settles the optional notification
instead of starting another song attempt. A selected song without exactly one
generated voice-memo attachment fails before receipt, transcript persistence,
or delivery and is never replaced by a text-only response. A committed delivery
intent retains the ordinary outbox retry and deduplication behavior.

Hosted invocation-scoped automation and device authority enters only the
current root turn through narrow typed dynamic tools backed by existing domain
ports. The App Server and its descendant shell environments never receive that
authority. Dynamic-tool dispatch requires the exact active root turn and
rejects descendant, stale-turn, or foreign-thread calls; closing the invocation
withdraws the tools without replacing the App Server.

MultiAgent V2 descendants admitted before the root final reply may keep working
through Codex's native lifecycle after that reply. Root completion and the next
ordinary turn do not terminate them. They retain normal local canonical
vault CLI/filesystem authority, but never inherit the root turn's
invocation-scoped automation or device capability.

Hosted runtime env projection remains owned by the hosted runtime before it
calls assistant-engine. The resident App Server is replaced only when its Node
runtime/container shuts down, the process exits, provider-protocol evidence
proves it unhealthy or poisoned, an operator explicitly shuts it down, or a
genuine process-level setting changes that Codex cannot accept through thread
or turn RPC. Abort cleanup applies to the affected turn; routine turn completion
is not process cleanup.

## Read-only Assistant Ask

`executeReadOnlyAssistantAsk`, exported from
`@murphai/assistant-engine/assistant-ask`, is the one deliberate exception to
the warm single-process path. It starts a separate one-shot Codex App Server
child for a target-owned Assistant Ask, so its provider latency, failure, and
interruption domain cannot block or poison the resident foreground process. The
trusted caller supplies the authorized target workspace root plus one untrusted
question; the executor owns no membership, routing, mailbox, retry, or delivery
state and returns only one schema-checked bounded answer.

The child reuses the trusted hosted Codex home for minimum provider auth and
configuration, but starts from a fresh empty working directory and removes that
directory after the exact child exits. It uses process lifetime `one-shot`; its
`thread/start` request sets `permissions = "murph-group-read"`, exact
`runtimeWorkspaceRoots`, `ephemeral = true`, and approval policy `never` without
legacy `sandbox`. The pinned App Server must attest the effective profile,
roots, working directory, empty instruction sources, and approval policy before
the turn starts. The profile permits read-only access to the exact target roots
while denying `.runtime/**`, `.codex/**`, environment files, writes, other
workspaces, and tool network. Model-run shell commands inherit no provider
credential or hosted secret. The child's only dynamic tool is the consent-aware
lazy `murph.group/read_shared` read. It receives no mutation or delivery route,
MCP, web search, memory, plugin, app, or multi-agent authority.

The runtime may keep one such child beside foreground work. It owns the exact
process handle and must interrupt, await with bounded grace, terminate only
that proven-owned child if needed, and prove exit before its workspace can be
checkpointed, replaced, or released. Further asks remain pending in the
existing hosted mailbox; assistant-engine does not add a process pool or
scheduler.

`executeConsentedReadOnlyAssistantAsk` is the disclosure-scoped composition of
that primitive. Its first one-shot child reads the authorized personal
workspace with the exact immutable permission context and proposes one bounded
answer. A second, sequential, fresh-context one-shot child receives only that
permission, the incoming question, and the proposed answer against an empty
runtime root. It has no personal workspace, conversation history, dynamic
tools, delivery route, network, or other authority and returns only `allow` or
`deny`.

There is no incoming model reviewer and no rewrite pass. The reviewer interprets
the proposed answer in the context of the question because a terse confirmation
can disclose the question's premise. An allow returns the candidate bytes
unchanged; deny produces `cannot_answer`, while invalid output fails closed for
the existing retry/expiry lifecycle. This executor still owns no grant,
membership, routing, persistence, retry, completion, or delivery
state. Web and the hosted runtime must revalidate those boundaries before the
read and before exact-byte group delivery.

Private grant discovery reuses `murph.group(action="list_memberships")`, whose
successful result includes a top-level `disclosureGrants` array. The runtime
normalizes older additive responses without that field to an empty array, and
`revoke_disclosure_grant` may use only an exact id from the private list.

## Dynamic tool contracts

Route planning is the single owner of the dynamic tool contract. It resolves the
exact tool array once, fingerprints that array, and stores it on
`AssistantRouteTurnPlan.dynamicTools`. Provider conversion forwards the complete
turn object, and Codex sends that same array in `thread/start`; downstream layers
must not rebuild it from copied gate booleans.

Broad, low-frequency native tools use Codex's `deferLoading` field while keeping
their ordinary argument and result contracts. The pinned App Server owns
discovery: direct-tool models use native `tool_search`, while code-mode models
expose only generic `ALL_TOOLS` metadata and dispatch the selected tool through
`exec`. Narrow non-deferred tools remain eager: direct-tool models receive the
native function, while code-mode-only models receive its schema in `exec`
guidance without a search step. Murph must not add a second discovery action,
execution envelope, or compatibility namespace.

Runtime authority remains independent of advertisement. Hosted transports are
typed services on `AssistantHostedToolContext`, and each tool checks that service
again when invoked. Adding a tool therefore requires only:

1. defining and dispatching the tool in `src/assistant-codex/dynamic-tools.ts`;
2. exposing any required typed service through `AssistantHostedToolContext`; and
3. including the tool in the planning-time `resolveMurphDynamicTools` call.

Do not add per-tool availability booleans to provider or app-server inputs.

`murph.plan_usage` follows this default-off rule. It is advertised only when a
hosted plan-usage service exists, accepts no arguments, and returns only the
web-authorized read projection. Assistant policy limits it to explicit member
questions or one trusted manual private check; it is not an onboarding or
recurring usage watcher. A thresholded `recommendedAction` is a suggestion;
personal `add_usage` recommendations may provide only the fixed first-party
Settings handoff, never choose an amount, initiate Checkout, or claim payment;
the separate `subscriptionActionQuote` is current terms for an explicit request
and is neither a recommendation nor consent. Start-now and Edge actions require
a matching current quote before exact confirmation. Usage-saving model options
use plain language rather than internal model codenames, “should we part ways?”
is only an optional trial off-ramp, and an active trial already set to continue
needs no unsolicited explanation.

`murph.labs` follows the same default-off shape. It is advertised only for a
verified private direct turn with a hosted Labs service and exposes bounded
live `search`, `show`, and ZIP `locations` reads. Broad health interests should
compare returned panels and included marker coverage; a named analyte should
use an exact search. The tool is discovery-only and must not claim medical
necessity, eligibility, a final quote, booking, ordering, or a launch date.

`murph.subscription` is also private and default-off. It is advertised only
when a hosted subscription service exists and the current private turn has
eligible accepted member input. Assistant policy requires one explicit,
unambiguous current-turn choice before calling it. The model supplies only the
bounded action; assistant-engine injects the current accepted input id before
the host call and consumes the ephemeral subscription capability on its first
use. Web separately claims the first action on the existing accepted-input
mailbox row, so restart or replay cannot use that input for a different action.
An exact action retry may continue; a conflicting action requires new eligible
member input. That binding proves current authority, not the meaning of the
message. The result exposes a Stripe-hosted URL only when payment is required,
and the tool never exposes a general billing or Stripe client.
