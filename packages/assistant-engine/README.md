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
another same-route detached session is never inferred as the owner. That turn
may bind its exact session before delivery finishes, but transcript import,
session advancement, and stale native provider-resume clearing remain gated on
canonical delivery. The outbox intent journals an interrupted
import, and nested hosted direct route plus accepted assistant-input authority
repairs it before provider-resume selection even for text-only payloads.
An ordinary direct scheduled occurrence also repairs an exact session-bound
obligation before provider-resume selection, but cannot claim unbound work;
that remains reserved for the first attended direct turn.
The direct output-only Assistant Ask continuation uses that same bound-only
admission before provider planning. A direct exact notification also repairs
only an obligation already bound to its resolved ordinary session before it
appends newer history; an isolated notification session cannot import another
session's obligation. Rejected completions, unrelated-session continuations,
and every generic detached notification remain unable to claim unbound work.
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

**Runtime failure diagnostics.** Codex command failures reuse the existing
assistant runtime-issue path. The turn-scoped classifier persists only the
existing finite command family, a turn-local command ordinal saturated at
10,000, the numeric exit code, and duration/output-size buckets. It never
persists command text, arguments, paths, output, payloads or provider action
identifiers. A direct bare `rg` or `grep` exit code 1 remains an expected no-match.
A later direct search success sets `recoveredAfterFailure` only at family level;
it does not assert that the exact query was retried.

For a failed, already-classified `vault-cli event` command, the same
`CODEX_COMMAND_EXIT_NONZERO` issue adds `details.vaultCliErrorCategory`:
`invalid_input`, `not_found`, `conflict`, `unavailable` or `unknown`. The owner
transiently parses the **entire** `aggregatedOutput` (or its snake-case alias),
only when at most 16,384 UTF-8 bytes. It accepts the CLI's direct JSON error
object or `--full-output` `{ok:false,error:...}` envelope, with string code and
message and optional boolean retryable. Only current event/usecase and
operator-config projection codes are allowlisted. `contract_invalid` requires
`stage=validation` to mean invalid input; otherwise its cause is unknown.
No arbitrary code, text, nested error, output excerpt or metadata is copied.
Malformed, truncated, excessive, non-JSON and unrecognized output stays
`unknown`. Other command families have no new field; no extra CLI event or
success log is emitted. A CLI `not_found` category does not change its exit
status or existing failed-action count.

Automation's local owner adds one `AUTOMATION_TOOL_FAILED` issue through the
existing `result.runtimeIssueInputs` transport. `operation` is only `save`,
`patch`, `inspect`, `reconcile` or `attach_follow_up`. `details.failureReason`
labels the branch: `unavailable`, `authority_rejected`, `version_conflict`,
`action_result_mismatch`, `oversized_result`, `result_serialization_failed` or
`handler_exception`. The last adds `handlerErrorCode`: only `invalid_option`,
`automation_not_found` or `unknown`. These codes do not infer authority from
exception prose. Serialization failure and size rejection keep the same
existing RPC rejection text. Success, including inspect-not-found and accepted
optional follow-up attachment, emits no branch diagnostic. Validation and
root-turn dispatch rejection remain with their existing owners.

These are **failure classifications, not another call denominator**. Generic
`CODEX_DYNAMIC_TOOL_CALL_FAILED` rows may coexist with automation branch rows;
never add the two to count failed calls. Use existing action-diagnostics
command/tool call counts for rates over the same window and deployment cohort.
The unchanged eight-issue per-turn cap, best-effort writes and export retries
make coverage lossy: missing diagnostics never prove success or no traffic.
There is no new queue, awaited tool-path I/O, state, schema or dependency.

For future natural-traffic verification, use read-only aggregate queries with
bounded time parameters. This example returns only finite labels and counts,
not content, raw rows or identifiers:

```sql
SELECT
  CASE WHEN error_code = 'AUTOMATION_TOOL_FAILED' THEN 'automation'
       ELSE 'vault-cli event' END AS diagnostic_surface,
  CASE WHEN error_code = 'AUTOMATION_TOOL_FAILED'
       THEN CASE WHEN operation IN ('save', 'patch', 'inspect', 'reconcile', 'attach_follow_up')
                 THEN operation ELSE 'missing_or_unrecognized' END
       ELSE 'command.execution' END AS operation,
  CASE WHEN error_code = 'AUTOMATION_TOOL_FAILED'
       THEN CASE WHEN details_json->>'failureReason' IN (
                   'unavailable', 'authority_rejected', 'version_conflict',
                   'action_result_mismatch', 'oversized_result',
                   'result_serialization_failed', 'handler_exception')
                 THEN details_json->>'failureReason' ELSE 'missing_evidence' END
       ELSE CASE WHEN NOT (details_json ? 'vaultCliErrorCategory') THEN 'missing_evidence'
                 WHEN details_json->>'vaultCliErrorCategory' IN (
                   'invalid_input', 'not_found', 'conflict', 'unavailable', 'unknown')
                 THEN details_json->>'vaultCliErrorCategory' ELSE 'unrecognized_evidence' END
       END AS failure_category,
  CASE WHEN details_json->>'handlerErrorCode' IN ('invalid_option', 'automation_not_found', 'unknown')
       THEN details_json->>'handlerErrorCode' ELSE 'not_recorded' END AS handler_code,
  count(*) AS diagnostic_rows
FROM hosted_assistant_runtime_issue
WHERE occurred_at >= $1 AND occurred_at < $2
  AND ((component = 'assistant.automation' AND error_code = 'AUTOMATION_TOOL_FAILED')
    OR (component = 'assistant.codex-action' AND error_code = 'CODEX_COMMAND_EXIT_NONZERO'
        AND details_json->>'commandFamily' = 'vault-cli event'))
GROUP BY 1, 2, 3, 4;
```

Missing fields from older versions are **missing evidence**, not the explicit
`unknown` classification. Old automation versions emit no branch rows at all;
retain their generic failures separately, never union/sum them with branch rows
as calls. Older classifiers may also lack event-family attribution. Existing
release provenance can select a compatible deployment cohort before aggregation;
new optional details remain compatible with existing sanitizers/exporters and
mixed-version records. After deployment, observe natural traffic only, confirm
finite categories survive export without content, and compare diagnostic
coverage with the existing call denominator. No live assistant journey or
production failure injection is required by this telemetry-only change.

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
`@murphai/assistant-engine/assistant-ask`, starts a separate one-shot Codex App
Server child for detached group/member reads. The caller supplies the target
workspace and question; the engine owns no membership, mailbox, retry,
persistence, or delivery state. The native `murph-group-read` profile makes the
workspace read-only and hides private runtime/configuration state. Joined-group
asks alone may receive `murph.group/read_shared`.

`executeOperatorDiagnostic` is the direct authenticated-operator variant. It
runs one turn with `murph-operator-diagnostic-read`, the bound workspace
including `.runtime`, and only the hosted Codex `sessions/` directory as an
optional second root. It has no writes, network, dynamic tools, project
configuration, effects, or delivery authority, and returns directly to the
caller's encrypted Ops-only result instead of entering member disclosure review.

Every detached turn uses a fresh temporary working directory, exact host-bound
roots, approval policy `never`, and one-shot process lifetime. The hosted
runtime owns cancellation and retries and permits at most one detached child
beside the resident foreground process. `executeConsentedReadOnlyAssistantAsk`
remains the member disclosure composition: a candidate runs under
`murph-group-read`, then a second tool-free child may allow its exact bytes or
return `cannot_answer`.

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

Response-card, exercise-routine, Telegram rich-content, and group-challenge
card tools follow the same deferred contract. Resident messaging guidance
provides the discovery trigger; the discovered tool remains the sole owner of
its complete schema, prerequisite reads, eligibility, and fallback rules.
Ordinary turns avoid those schemas; card-producing turns still pay for native
discovery and the full selected contract.

Stable route instructions own capability-dependent research guidance and the
late-child-result policy. Dynamic context carries only the trusted ordinary
inbound marker and current facts. Research capability changes therefore change
the native thread fingerprint. Group email omits filesystem skill routing,
browser procedures, and CLI recipes while retaining resident health guidance
and the existing sender-authority boundary. Automation instructions keep task
triggers and essential timing/readback invariants resident; detailed arguments,
recovery, and projection semantics live in the discovered automation contract.
Later timing questions require a fresh inspection; successful writes already
include their own readback and need no redundant verification.

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

## Experiment support policy

The experiment-onboarding entrypoint retains safety, protocol resolution, run
creation, and active-session logging rules. First-session guidance and support
mechanics live in the co-packaged `references/session-support.md`, which must be
read before support questions or effects. Normal recursive skill packaging and
filesystem reads remain the owners. Keep that reference in focused real-Codex
fixtures when changing support policy.

## Real-Codex test fixtures

Synthetic real-Codex journeys that need fixture executables can opt into
`executeRealCodexAppServerTurn`'s `fixtureBinDirectory`. The test harness adds
that directory to PATH and creates a private login profile beneath the journey's
working directory, whose existing cleanup owns it. Ordinary calls retain their
supplied environment. An explicit caller `ZDOTDIR` remains caller-owned and
cannot be combined with automatic fixture-profile preparation. Deterministic
harness tests exercise actual `zsh -lc` selection when zsh is installed; that
integration case explicitly skips when the executable is absent. Portable
profile quoting, provider-key exclusion, and caller-profile ownership remain
covered without zsh. These tests do not start Codex or make a model request.
