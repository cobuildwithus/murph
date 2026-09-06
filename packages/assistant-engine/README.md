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

**Runtime failure diagnostics.** All Murph dynamic-tool returned failures share
one private `failureDiagnostic` contract and one dispatch boundary. Handlers use
finite branch reasons where they know the cause; unannotated failures explicitly
receive `unknown`. `rpcResult`, prompts, schemas, calls, retries, mutations and
thrown-error behavior are unchanged. The metadata never enters RPC content.

The existing `result.runtimeIssueInputs` transport carries
`ASSISTANT_DYNAMIC_TOOL_FAILED` classifications with the finite request kind as
`operation`/`details.requestKind`. The shared owner replaces the former
`AUTOMATION_TOOL_FAILED` helper. Existing group-specific issues retain their
codes and fields and are enriched, not accompanied by another branch issue.
Schema rejection and unsupported requests keep their existing intake issues;
outer thrown exceptions keep the existing caller issue and exact rejection.
Caller-owned admission/finalization refusals use the same finite issue helper,
without a duplicate when intake or dispatch already supplied a classification.
Success and expected domain outcomes (including inspect-not-found and accepted
optional follow-up attachment) produce no new diagnostic.

`details.failureStage` is `admission`, `validation`, `execution`, `result` or
`delivery`. `details.failureReason` is one of `unknown`, `unavailable`,
`authority_rejected`, `invalid_input`, `unsupported_request`, `not_found`,
`conflict`, `limit_reached`, `action_result_mismatch`, `invalid_result`,
`oversized_result`, `result_serialization_failed`, `empty_result`,
`handler_exception`, `reported_failure` or `nonzero_exit`. Caught errors may add
`details.errorCategory`: `unknown`, `invalid_input`, `not_found`, `conflict`,
`unavailable`, `authority_rejected`, `invalid_result`, `rate_limited` or `timeout`.
The mapper reads only fixed scalar code/status properties and the typed
`VaultCliError` context's status/stage/timeout evidence. It never infers a cause
from exception names, messages, stacks, nested causes or provider detail.
Unmapped provider codes and opaque exceptions remain `unknown`; existing
specialist group classifications remain available alongside this vocabulary.

The generic completed-action failure owner continues to emit
`CODEX_COMMAND_EXIT_NONZERO`, `CODEX_DYNAMIC_TOOL_CALL_FAILED` and
`CODEX_TOOL_CALL_FAILED` with the same identity/duration/output-size keys,
failure predicate and deduplication. It adds finite failure stage/reason and
`errorCategory` (explicitly `unknown` without safe evidence). A command's
nonzero exit is structural execution evidence; a tool's `success:false` is a
reported result failure; a failed status alone has unknown cause. MCP provider
payloads are not parsed. These additions do not turn a domain outcome into a
failed action or invent failures that the tracker does not already observe.

For **every recognized Vault CLI invocation**, not just `event`, the same
command issue adds both `errorCategory` and the compatible
`vaultCliErrorCategory` key. Recognition reuses the existing bounded executable
parser, independently of its finite family label. This includes automation,
knowledge, food/meal/goal/memory command families, batch invocations and an
unknown subcommand of a recognized executable. Only child events actually
observed by the current tracker are covered; batch results are not expanded
into extra actions. Arbitrary shell error JSON is never classified as Vault CLI.
The owner transiently parses the **complete** `aggregatedOutput` (or its
snake-case alias) only at or below 16,384 UTF-8 bytes. It accepts the CLI's direct
JSON error object or `--full-output` `{ok:false,error:...}` envelope with string
code/message and optional boolean retryable. Only finite current projection
codes are mapped; `contract_invalid` requires `stage=validation` to mean invalid
input. Malformed, truncated, oversized or unrecognized output stays `unknown`.
No arguments, output excerpts, arbitrary codes, paths, IDs, member content or
provider payloads enter these new fields. Existing numeric exit code, saturated
turn-local ordinal and finite family attribution are unchanged. Bare `rg` or
`grep` exit 1 remains expected no-match; recovery remains family-level only.

These are **classifications, not another call denominator**.
`diagnosticRole=classification` marks dynamic-tool/branch/intake rows and
`diagnosticRole=completion` marks generic failed-action rows. A failed dynamic
call may produce both: never add them as failed calls. Even completion rows are
not a lossless ledger. Use existing action-diagnostics counts for rates over the
same window and deployment cohort. The unchanged eight-issue per-turn cap,
best-effort writes and export retries make coverage lossy; missing diagnostics
never prove success or no traffic. There is no new queue, awaited tool-path I/O,
state, schema, backend or dependency.

For future natural-traffic verification, use read-only aggregate queries with
bounded time parameters. This mixed-version recipe emits only finite labels
and counts, never raw rows or identifiers:

```sql
WITH projected AS (
  SELECT
    CASE
      WHEN component = 'assistant.automation' THEN 'legacy_automation'
      WHEN component = 'assistant.group-tool' THEN 'group_classification'
      WHEN component = 'assistant.tool-validation' THEN 'input_validation'
      WHEN component = 'assistant.codex-dynamic-tool' THEN 'dynamic_classification'
      WHEN error_code = 'CODEX_COMMAND_EXIT_NONZERO' THEN 'command_completion'
      WHEN error_code = 'CODEX_TOOL_CALL_FAILED' THEN 'mcp_completion'
      ELSE 'dynamic_completion'
    END AS diagnostic_surface,
    CASE WHEN details_json->>'diagnosticRole' IN ('classification', 'completion')
         THEN details_json->>'diagnosticRole' ELSE 'missing_evidence' END AS diagnostic_role,
    CASE WHEN details_json->>'failureStage' IN (
                   'admission', 'validation', 'execution', 'result', 'delivery')
         THEN details_json->>'failureStage' ELSE 'missing_evidence' END AS failure_stage,
    CASE WHEN NOT (details_json ? 'failureReason') THEN 'missing_evidence'
         WHEN details_json->>'failureReason' IN (
                   'unknown', 'unavailable', 'authority_rejected', 'invalid_input',
                   'unsupported_request', 'not_found', 'conflict', 'version_conflict',
                   'limit_reached', 'action_result_mismatch', 'invalid_result',
                   'oversized_result', 'result_serialization_failed', 'empty_result',
                   'handler_exception', 'reported_failure', 'nonzero_exit')
         THEN details_json->>'failureReason' ELSE 'unrecognized_evidence' END AS failure_reason,
    COALESCE(details_json->>'errorCategory', details_json->>'vaultCliErrorCategory',
      CASE details_json->>'handlerErrorCode'
        WHEN 'invalid_option' THEN 'invalid_input'
        WHEN 'automation_not_found' THEN 'not_found'
        WHEN 'unknown' THEN 'unknown' END) AS category
  FROM hosted_assistant_runtime_issue
  WHERE occurred_at >= $1 AND occurred_at < $2
    AND ((component = 'assistant.automation' AND error_code = 'AUTOMATION_TOOL_FAILED')
      OR component IN ('assistant.codex-dynamic-tool', 'assistant.group-tool')
      OR (component = 'assistant.tool-validation' AND error_code = 'TOOL_INPUT_SCHEMA_REJECTION')
      OR (component = 'assistant.codex-action' AND error_code IN (
           'CODEX_COMMAND_EXIT_NONZERO', 'CODEX_DYNAMIC_TOOL_CALL_FAILED',
           'CODEX_TOOL_CALL_FAILED')))
)
SELECT diagnostic_surface, diagnostic_role, failure_stage, failure_reason,
       CASE WHEN category IS NULL THEN 'missing_evidence'
            WHEN category IN ('unknown', 'invalid_input', 'not_found', 'conflict',
                    'unavailable', 'authority_rejected', 'invalid_result',
                    'rate_limited', 'timeout')
            THEN category ELSE 'unrecognized_evidence' END AS error_category,
       count(*) AS diagnostic_rows
FROM projected
GROUP BY 1, 2, 3, 4, 5;
```

Missing fields on older records are **missing evidence**, distinct from explicit
`unknown`. Historical automation-only rows remain queryable; new classifications
use the common dynamic-tool code and `conflict` rather than `version_conflict`.
The generic event codes/keys and runtime-issue schema remain compatible with
existing sanitizers and consumers; automation-specific consumers must include
the common classification rows. Existing release provenance can select a
compatible deployment cohort. After deployment, observe natural traffic only
and compare classification coverage with existing action counts. No production
failure injection or live assistant journey is required for this telemetry-only
change.

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
