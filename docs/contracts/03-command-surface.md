# Command Surface

Status: frozen baseline plus health extension fence for `vault-cli`

## Namespace

- The only public baseline namespace is `vault-cli`.
- `packages/cli` owns command registration, schema validation, and delegation into `core`, `importers`, and `query`.
- `device` commands delegate to the local `@murphai/device-syncd` control plane for provider OAuth/account actions while leaving canonical health writes behind the existing importer/core boundary, and the CLI may start or reuse that local daemon for the selected vault when no explicit control-plane target is provided.
- Native `incur` owns the transport envelope and human-oriented formatting behavior.
- `packages/cli` must not write vault files directly. Write commands delegate to `packages/core` or `packages/importers`; read commands delegate to `packages/query`.

## Command Groups

```text
vault-cli init --vault <path> [--request-id <id>]
vault-cli validate --vault <path> [--request-id <id>]
vault-cli vault show --vault <path> [--request-id <id>]
vault-cli vault stats --vault <path> [--request-id <id>]
vault-cli vault repair --vault <path> [--request-id <id>]
vault-cli vault update --vault <path> [--title <title>] [--timezone <tz>] [--request-id <id>]
vault-cli audit show <id> --vault <path> [--request-id <id>]
vault-cli audit list --vault <path> [--action <action>] [--actor <actor>] [--status <status>] [--from <date>] [--to <date>] [--sort asc|desc] [--limit <n>] [--request-id <id>]
vault-cli audit tail --vault <path> [--limit <n>] [--request-id <id>]
vault-cli chat [prompt] --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--sourceThread <id>] [--provider codex-cli] [--codexCommand <path>] [--model <model>] [--sandbox read-only|workspace-write|danger-full-access] [--approvalPolicy untrusted|on-request|never] [--profile <name>] [--oss] [--request-id <id>]
vault-cli run --vault <path> [--model <model>] [--baseUrl <url>] [--apiKey <key>] [--apiKeyEnv <name>] [--providerName <name>] [--headersJson <json>] [--scanIntervalMs <ms>] [--maxPerScan <n>] [--allowSelfAuthored] [--sessionRolloverHours <hours>] [--once] [--skipDaemon] [--request-id <id>]
vault-cli research <prompt> --vault <path> [--title <title>] [--chat <url-or-id>] [--browserPath <path>] [--timeout <duration>] [--waitTimeout <duration>] [--request-id <id>]
vault-cli deepthink <prompt> --vault <path> [--title <title>] [--chat <url-or-id>] [--browserPath <path>] [--timeout <duration>] [--waitTimeout <duration>] [--request-id <id>]
vault-cli knowledge upsert --vault <path> --body <markdown> [--title <title>] [--slug <slug>] [--page-type <type>] [--status <status>] [--clear-library-links] [--library-slug <slug> ...] [--related-slug <slug> ...] [--source-path <path> ...] [--request-id <id>]
vault-cli knowledge list --vault <path> [--page-type <type>] [--status <status>] [--request-id <id>]
vault-cli knowledge search <query> --vault <path> [--page-type <type>] [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli knowledge show <slug> --vault <path> [--request-id <id>]
vault-cli knowledge lint --vault <path> [--request-id <id>]
vault-cli knowledge log tail --vault <path> [--limit <n>] [--request-id <id>]
vault-cli knowledge index rebuild --vault <path> [--request-id <id>]
vault-cli assistant ask <prompt> --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--sourceThread <id>] [--provider codex-cli|openai-compatible] [--codexCommand <path>] [--model <model>] [--baseUrl <url>] [--apiKeyEnv <name>] [--providerName <name>] [--sandbox read-only|workspace-write|danger-full-access] [--approvalPolicy untrusted|on-request|never] [--profile <name>] [--oss] [--deliverResponse] [--deliveryTarget <target>] [--request-id <id>]
vault-cli assistant chat [prompt] --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--sourceThread <id>] [--provider codex-cli|openai-compatible] [--codexCommand <path>] [--model <model>] [--baseUrl <url>] [--apiKeyEnv <name>] [--providerName <name>] [--sandbox read-only|workspace-write|danger-full-access] [--approvalPolicy untrusted|on-request|never] [--profile <name>] [--oss] [--request-id <id>]
vault-cli assistant deliver <message> --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--sourceThread <id>] [--deliveryTarget <target>] [--request-id <id>]
vault-cli assistant status --vault <path> [--session <id>] [--limit <n>] [--request-id <id>]
vault-cli assistant doctor --vault <path> [--repair] [--request-id <id>]
vault-cli assistant run --vault <path> [--model <model>] [--baseUrl <url>] [--apiKey <key>] [--apiKeyEnv <name>] [--providerName <name>] [--headersJson <json>] [--scanIntervalMs <ms>] [--maxPerScan <n>] [--allowSelfAuthored] [--sessionRolloverHours <hours>] [--once] [--skipDaemon] [--request-id <id>]
vault-cli assistant stop --vault <path> [--request-id <id>]
vault-cli status --vault <path> [--session <id>] [--limit <n>] [--request-id <id>]
vault-cli doctor --vault <path> [--repair] [--request-id <id>]
vault-cli stop --vault <path> [--request-id <id>]
vault-cli assistant session list --vault <path> [--request-id <id>]
vault-cli assistant session show <sessionId> --vault <path> [--request-id <id>]
vault-cli memory show [memoryId] --vault <path>
vault-cli memory search [text] --vault <path> [--section <section>] [--limit <n>]
vault-cli memory upsert <text> --vault <path> --section <section> [--memoryId <id>]
vault-cli memory forget <memoryId> --vault <path>
vault-cli automation scaffold --vault <path>
vault-cli automation show <lookup> --vault <path>
vault-cli automation list --vault <path> [--status <status> ...] [--text <query>] [--limit <n>]
vault-cli automation upsert --vault <path> --input @payload.json|-
vault-cli device provider list --vault <path> [--baseUrl <url>]
vault-cli device connect <provider> --vault <path> [--baseUrl <url>] [--returnTo <url>] [--open]
vault-cli device account list --vault <path> [--baseUrl <url>] [--provider <provider>]
vault-cli device account show <accountId> --vault <path> [--baseUrl <url>]
vault-cli device account reconcile <accountId> --vault <path> [--baseUrl <url>]
vault-cli device account disconnect <accountId> --vault <path> [--baseUrl <url>]
vault-cli device daemon status --vault <path> [--baseUrl <url>]
vault-cli device daemon start --vault <path> [--baseUrl <url>]
vault-cli device daemon stop --vault <path> [--baseUrl <url>]
vault-cli provider scaffold --vault <path> [--request-id <id>]
vault-cli provider upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli provider show <id> --vault <path> [--request-id <id>]
vault-cli provider list --vault <path> [--status active|inactive] [--limit <n>] [--request-id <id>]
vault-cli food scaffold --vault <path> [--request-id <id>]
vault-cli food upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli food rename <id> --vault <path> --title <title> [--slug <slug>] [--request-id <id>]
vault-cli food schedule <title> --vault <path> --time <HH:MM> [--note <text>] [--slug <slug>] [--request-id <id>]
vault-cli food show <id> --vault <path> [--request-id <id>]
vault-cli food list --vault <path> [--status active|archived] [--limit <n>] [--request-id <id>]
vault-cli recipe scaffold --vault <path> [--request-id <id>]
vault-cli recipe upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli recipe show <id> --vault <path> [--request-id <id>]
vault-cli recipe list --vault <path> [--status draft|saved|archived] [--limit <n>] [--request-id <id>]
vault-cli event scaffold --vault <path> --kind <kind> [--request-id <id>]
vault-cli event upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli event edit <id> --vault <path> [--input @patch.json] [--set <path=value> ...] [--clear <path> ...] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli event show <id> --vault <path> [--request-id <id>]
vault-cli event list --vault <path> [--kind <kind>] [--from <date>] [--to <date>] [--tag <tag> ...] [--experiment <slug>] [--limit <n>] [--request-id <id>]
vault-cli document import <file> --vault <path> [--title <title>] [--occurred-at <ts>] [--note "..."] [--source <source>] [--request-id <id>]
vault-cli document edit <id> --vault <path> [--input @patch.json] [--set <path=value> ...] [--clear <path> ...] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli document show <id> --vault <path> [--request-id <id>]
vault-cli document list --vault <path> [--from <date>] [--to <date>] [--request-id <id>]
vault-cli document manifest <id> --vault <path> [--request-id <id>]
vault-cli meal add --vault <path> [--photo <path>] [--audio <path>] [--note "..."] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli meal edit <id> --vault <path> [--input @patch.json] [--set <path=value> ...] [--clear <path> ...] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli meal show <id> --vault <path> [--request-id <id>]
vault-cli workout add <text> --vault <path> [--duration <minutes>] [--type <type>] [--distance-km <km>] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli workout edit <id> --vault <path> [--input @patch.json] [--set <path=value> ...] [--clear <path> ...] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli workout format save <name> <text> --vault <path> [--duration <minutes>] [--type <type>] [--distance-km <km>] [--request-id <id>]
vault-cli workout format show <name> --vault <path> [--request-id <id>]
vault-cli workout format list --vault <path> [--limit <n>] [--request-id <id>]
vault-cli workout format log <name> --vault <path> [--duration <minutes>] [--type <type>] [--distance-km <km>] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli intervention add <text> --vault <path> [--duration <minutes>] [--type <type>] [--protocol-id <protocolId>] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli intervention edit <id> --vault <path> [--input @patch.json] [--set <path=value> ...] [--clear <path> ...] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli meal list --vault <path> [--from <date>] [--to <date>] [--request-id <id>]
vault-cli meal manifest <id> --vault <path> [--request-id <id>]
vault-cli samples add --vault <path> --input @file.json [--request-id <id>]
vault-cli samples import-csv <file> --vault <path> [--preset <id>] [--stream <stream>] [--ts-column <name>] [--value-column <name>] [--unit <unit>] [--delimiter <char>] [--metadata-columns <name> ...] [--source <source>] [--request-id <id>]
vault-cli samples show <id> --vault <path> [--request-id <id>]
vault-cli samples list --vault <path> [--stream <stream>] [--from <date>] [--to <date>] [--quality <quality>] [--limit <n>] [--request-id <id>]
vault-cli samples batch show <id> --vault <path> [--request-id <id>]
vault-cli samples batch list --vault <path> [--stream <stream>] [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli experiment create <slug> --vault <path> [--title <title>] [--hypothesis <text>] [--started-on <date>] [--status <status>] [--request-id <id>]
vault-cli experiment show <id> --vault <path> [--request-id <id>]
vault-cli experiment list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli experiment update --vault <path> --input @file.json [--request-id <id>]
vault-cli experiment checkpoint --vault <path> --input @file.json [--request-id <id>]
vault-cli experiment stop <id> --vault <path> [--occurred-at <ts>] [--note "..."] [--request-id <id>]
vault-cli journal ensure <date> --vault <path> [--request-id <id>]
vault-cli journal show <date> --vault <path> [--request-id <id>]
vault-cli journal list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli journal append <date> --vault <path> --text "..." [--request-id <id>]
vault-cli journal link <date> --vault <path> [--event-id <evt_*> ...] [--stream <stream> ...] [--request-id <id>]
vault-cli journal unlink <date> --vault <path> [--event-id <evt_*> ...] [--stream <stream> ...] [--request-id <id>]
vault-cli show <id> --vault <path> [--request-id <id>]
vault-cli list --vault <path> [--record-type <type> ...] [--kind <kind>] [--status <status>] [--stream <stream> ...] [--tag <tag> ...] [--experiment <slug>] [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli search query --vault <path> --text <query> [--record-type <type> ...] [--kind <kind> ...] [--stream <stream> ...] [--experiment <slug>] [--from <date>] [--to <date>] [--tag <tag> ...] [--limit <n>] [--request-id <id>]
vault-cli query projection status --vault <path> [--request-id <id>]
vault-cli query projection rebuild --vault <path> [--request-id <id>]
vault-cli timeline --vault <path> [--from <date>] [--to <date>] [--experiment <slug>] [--kind <kind> ...] [--stream <stream> ...] [--entry-type <type> ...] [--limit <n>] [--request-id <id>]
vault-cli export pack create --vault <path> --from <date> --to <date> [--experiment <slug>] [--out <dir>] [--request-id <id>]
vault-cli export pack show <id> --vault <path> [--request-id <id>]
vault-cli export pack list --vault <path> [--from <date>] [--to <date>] [--experiment <slug>] [--limit <n>] [--request-id <id>]
vault-cli export pack materialize <id> --vault <path> [--out <dir>] [--request-id <id>]
vault-cli export pack prune <id> --vault <path> [--request-id <id>]
vault-cli intake import <file> --vault <path> [--title <title>] [--occurred-at <ts>] [--imported-at <ts>] [--source <source>] [--request-id <id>]
vault-cli intake show <id> --vault <path> [--request-id <id>]
vault-cli intake list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli intake manifest <id> --vault <path> [--request-id <id>]
vault-cli intake raw <id> --vault <path> [--request-id <id>]
vault-cli intake project <id> --vault <path> [--request-id <id>]
vault-cli profile current rebuild --vault <path> [--request-id <id>]
vault-cli protocol stop <protocolId> --vault <path> [--stopped-on <date>] [--request-id <id>]
vault-cli supplement scaffold --vault <path> [--request-id <id>]
vault-cli supplement upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli supplement rename <id> --vault <path> --title <title> [--slug <slug>] [--request-id <id>]
vault-cli supplement show <id> --vault <path> [--request-id <id>]
vault-cli supplement list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli supplement stop <protocolId> --vault <path> [--stopped-on <date>] [--request-id <id>]
vault-cli supplement compound list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli supplement compound show <compound> --vault <path> [--status <status>] [--request-id <id>]
vault-cli inbox bootstrap --vault <path> [--rebuild] [--strict] [--ffmpegCommand <command>] [--pdftotextCommand <command>] [--whisperCommand <command>] [--whisperModelPath <path>] [--request-id <id>]
vault-cli inbox attachment list <captureId> --vault <path> [--request-id <id>]
vault-cli inbox attachment show <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox attachment show-status <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox attachment parse <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox attachment reparse <attachmentId> --vault <path> [--request-id <id>]
vault-cli inbox promote meal <captureId> --vault <path> [--request-id <id>]
vault-cli inbox promote document <captureId> --vault <path> [--request-id <id>]
vault-cli inbox promote journal <captureId> --vault <path> [--request-id <id>]
vault-cli inbox promote experiment-note <captureId> --vault <path> [--request-id <id>]
vault-cli inbox model bundle <captureId> --vault <path> [--request-id <id>]
vault-cli inbox model route <captureId> --vault <path> --model <model> [--baseUrl <url>] [--apiKey <key>] [--apiKeyEnv <name>] [--providerName <name>] [--headersJson <json>] [--apply] [--request-id <id>]
```

`vault-cli inbox model bundle` materializes the normalized routing bundle plus image-routing eligibility metadata. `vault-cli inbox model route` may attach supported stored routing images to the model request when the capture includes an eligible JPEG, PNG, WEBP, or GIF attachment.

For event-backed edit commands (`event`, `document`, `meal`, `workout`, `intervention`), changing `occurredAt` or `timeZone` without patching `dayKey` directly now requires `--day-key-policy keep|recompute`. This prevents silent stale-day retention and prevents legacy records without explicit `timeZone` provenance from silently materializing the vault default timezone into the saved record during edits.

`vault-cli assistant ask|chat|deliver|status|doctor|run|stop|session` persist or inspect assistant runtime state only. Durable user-facing memory is managed through the top-level canonical `memory` noun backed by `bank/memory.md`, and durable scheduled assistant prompts are managed through the top-level canonical `automation` noun backed by `bank/automations/*.md`. Accepted inbound assistant-automation captures may still auto-preserve stored document attachments into the canonical document import surface before later model routing or reply behavior runs, while leaving the original inbox capture evidence in place under `raw/inbox/**`. Coarse system-written turn receipts, replay-safe outbox intents, diagnostics snapshots, persisted status snapshots, provider failover cooldown state, and other assistant runtime artifacts live under `vault/.runtime/operations/assistant/**` for read-only `status` / `doctor` inspection. Session/provider-route-recovery JSON keeps only public provider headers; secret-bearing provider headers live in private sidecars under `vault/.runtime/operations/assistant/secrets/**`, and `assistant doctor --repair` can tighten permissive runtime modes in place. In provider-backed Codex sessions the live assistant runtime and canonical `memory` / `automation` surfaces are exposed as bounded tool surfaces, while OpenAI-compatible sessions replay the recent local transcript plus the same bootstrap system context on each turn. Assistant-originated writes are rebound to the real host-side user turn instead of trusting client-supplied provenance text, and the canonical vault remains authoritative.

The `assistant` noun is therefore runtime inspection/control only. If a future surface is user-facing, queryable, or intended as durable product state, it must become a canonical noun under `vault/**` or an explicit derived materialization, not an `assistant` runtime CRUD surface.

`vault-cli knowledge *` manages Murph's non-canonical personal compiled wiki under `derived/knowledge/**`. That wiki is distinct from the stable reference layer under `bank/library/**`: `bank/library` is durable shared health context, while `derived/knowledge` is the assistant-authored user-specific synthesis layer. `knowledge upsert` writes one page and refreshes `derived/knowledge/index.md`; each upsert also appends a chronological entry to `derived/knowledge/log.md`. `knowledge log tail` is the intentionally small operator-facing log inspection surface; richer wiki-maintainer behavior belongs in the assistant runtime prompt plus the first-class assistant knowledge tools, not in `AGENTS.md`.

The per-command synopses above intentionally omit incur-owned global output and discovery flags such as `--format`, `--json`, `--verbose`, `--schema`, `--llms`, `skills add`, and `--mcp`. Those surfaces are provided by incur and are not re-frozen command-by-command in this contract.

## Health Noun Grammar

```text
vault-cli <noun> scaffold --vault <path> [--request-id <id>]
vault-cli <noun> upsert --vault <path> --input @file.json [--request-id <id>]
vault-cli <noun> show <id|current> --vault <path> [--request-id <id>]
vault-cli <noun> list --vault <path> [--limit <n>] [--request-id <id>]
```

The placeholder grammar above applies to the frozen health nouns listed below when they expose the shared scaffold/upsert/show/list capability bundle.

## Capability Bundles

The command surface is organized around reusable capability bundles, not a payload-first grammar plus a growing exception list. The shared capability taxonomy lives in `packages/contracts/src/command-capabilities.ts`.

- `readable`: `show | list`
- `payloadCrud`: `scaffold | upsert | show | list`
- `artifactImport`: `import | show | list | manifest`
- `batchInspection`: `batch show | batch list`
- `lifecycle`: `create | show | list | update | checkpoint | stop`
- `dateAddressedDoc`: `ensure | show | list | append | link | unlink`
- `derivedAdmin`: `stats | rebuild | materialize | prune | validate`
- `runtimeControl`: `bootstrap | setup | doctor | parse | requeue | attachment list/show/show-status/parse/reparse | promote | model bundle/route`
- `deviceControl`: `provider list | connect | account list/show/reconcile/disconnect | daemon status/start/stop`

## Noun Composition

- `goal`, `condition`, `allergy`, `family`, `genetics`, `history`, `blood-test`, `provider`, `food`, and `event` are payload-CRUD nouns.
- `food` is a payload-CRUD noun backed by `bank/foods/*.md` for recurring meals, grocery staples, smoothies, and remembered restaurant orders, and `food schedule` adds the thinnest first-class recurring-food layer by pairing a remembered food with a daily note-only meal auto-log rule backed by assistant runtime automation internals.
- `recipe` is also a payload-CRUD noun backed by `bank/recipes/*.md`.
- `profile` is primarily payload CRUD and also exposes `rebuild` for the generated current-profile view.
- `protocol` is primarily payload CRUD and also exposes `stop` as an id-preserving lifecycle helper.
- `supplement` is a protocol-backed payload-CRUD noun for branded supplement products and also exposes `stop` plus a derived `compound` ledger that rolls overlapping active ingredients into canonical compound rows.
- `document` and `meal` are artifact-import nouns.
- `workout` is a quick-capture noun layered on top of canonical `activity_session` events; `workout format` adds only a thin saved-defaults layer under `bank/workout-formats/*.md` and still feeds the same canonical event path rather than introducing a competing workout subsystem.
- `intervention` is a quick-capture noun layered on top of canonical `intervention_session` events; it intentionally does not introduce a separate intervention record family or follow-up read grammar.
- `intake` is an artifact-import noun that also exposes `raw` and `project`.
- `samples` composes artifact import with batch inspection.
- `experiment` is a lifecycle noun.
- `journal` is a date-addressed document noun.
- `vault` composes readable and derived/admin capabilities, plus `update` for metadata mutation.
- `export` composes readable and derived/admin capabilities.
- `audit` is a readable noun with `tail` as its stream-style follow-up.
- `inbox` is a runtime-control noun, including attachment inspection, deterministic promotion flows, and audited model-routing helpers.
- `assistant` is a provider-backed orchestration noun for local chat turns, outbound delivery, session inspection, runtime diagnostics, and always-on inbox triage; it stores only runtime metadata under `vault/.runtime/operations/assistant/**`, uses explicit conversation bindings for session reuse, can opt into self-authored auto-reply plus age-based session rollover for dedicated self-chat threads, treats `--deliveryTarget` as a one-send override, only fires due canonical automations while `assistant run` is active for the vault, and delegates canonical promotions back through inbox/core boundaries.
- `memory` is a canonical product noun backed by `bank/memory.md`.
- `automation` is a canonical product noun backed by `bank/automations/*.md`.
- Top-level `chat` is a shorthand alias for `assistant chat`; it shares the same prompt/options/output contract so installed `murph chat` discovery stays truthful.
- Top-level `status` is a shorthand alias for `assistant status`; it shares the same option/output contract so installed `murph status` discovery stays truthful.
- Top-level `doctor` is a shorthand alias for `assistant doctor`; it shares the same option/output contract so installed `murph doctor` discovery stays truthful.
- Top-level `run` is a shorthand alias for `assistant run`; it shares the same option/output contract so installed `murph run` discovery stays truthful while keeping automation explicit.
- Top-level `stop` is a shorthand alias for `assistant stop`; it shares the same option/output contract so installed `murph stop` discovery stays truthful while giving operators a supported recovery path for stuck assistant automation locks.
- `device` is a local control-plane noun backed by `@murphai/device-syncd`; it exposes provider discovery plus browser-based connect/reconcile/disconnect actions, and it can also start, inspect, or stop the Murph-managed local daemon for the selected vault.

These are capabilities, not exceptions. For example, `event` remains the generic write/read surface for non-specialized event kinds, `provider` remains the registry-backed noun for `bank/providers/*.md`, and the inbox attachment commands remain the attachment-level runtime surface for `.runtime` plus `derived/inbox/**`.

Registry-backed readable/list surfaces may expose noun-specific filters where the underlying records justify them. `goal`, `condition`, `allergy`, `protocol`, and similar registry nouns may expose `--status <status>`. `profile list` exposes `--from` and `--to`. `history list` adds `--kind`, `--from`, and `--to`. `blood-test list` exposes `--status`, `--from`, and `--to`. Generic top-level `list` adds `--record-type`, `--status`, `--stream`, and `--tag` parity.

Frozen health nouns remain:

- `profile`
- `goal`
- `condition`
- `allergy`
- `food`
- `supplement`
- `protocol`
- `family`
- `genetics`
- `history`
- `blood-test`

## Native Incur Contract

Every command now uses native `incur` command definitions directly:

1. `incur` validates positional arguments and named options against the command schema.
2. The handler receives parsed `args` and `options` and delegates exactly one boundary call to `core`, `importers`, or `query`.
3. The handler returns the command-specific payload directly.
4. Non-verbose `--format json` writes that payload body directly to stdout.
5. `--verbose --format json` wraps the same payload in incur's success/error envelope, including metadata and CTAs when present.
6. Human-oriented rendering, alternate formats, completions, `--llms`, skills, and MCP surfaces are incur-owned and are not redefined here.

## Shared Option Rules

- `--vault <path>` is required for canonical vault commands so the target vault is explicit. `device` commands also require it so Murph can manage the local daemon and its launcher state for that vault, even when callers override the control-plane endpoint with `--baseUrl`.
- `--baseUrl <url>` overrides the reachable local control-plane endpoint for `device` commands. If omitted, the CLI uses `DEVICE_SYNC_BASE_URL` and then the Murph-managed local daemon default.
- `--request-id` is optional where exposed, forwarded to package service calls, and reserved for audit correlation.
- Incur's global output flags are available everywhere; this contract freezes only the command-specific option semantics and JSON payload shapes described below.
- Machine-stable callers that need metadata or CTA suggestions should prefer `--verbose --format json`. The payload examples below describe the `data` body emitted by non-verbose JSON mode.
- Retrieval filters and similar multi-value options use repeatable flags such as `--kind meal --kind note`, `--entry-type event --entry-type sample_summary`, or `--metadata-columns device --metadata-columns context`. Comma-delimited tokens such as `--kind meal,note` are invalid and should be rewritten as repeated flags.
- Canonical ids emitted by core/import flows follow the frozen `<prefix>_<ULID>` policy in `docs/contracts/02-record-schemas.md`.
- Commands that create or read canonical records align to the generated schemas in `packages/contracts/generated/`.
- Write/import commands return `lookupId` or `lookupIds` when the follow-on read path should use the canonical read id rather than a batch id or internal provenance id.
- `upsert --input @file.json` uses one file argument and does not expose per-field mutation flags in the public grammar.

## Lookup Rules

- `show` accepts canonical read ids such as `core`, `journal:<YYYY-MM-DD>`, `exp_*`, `evt_*`, `smp_*`, `aud_*`, `asmt_*`, `psnap_*`, `goal_*`, `cond_*`, `alg_*`, `prot_*`, `fam_*`, `var_*`, `doc_*`, and `meal_*`.
- `profile show current` and `profile current rebuild` target the generated `bank/profile/current.md` view rather than a standalone canonical record id.
- `provider show` accepts either the canonical `prov_*` id or the stable provider slug stored in `bank/providers/<slug>.md`.
- `food show` accepts either the canonical `food_*` id or the stable food slug stored in `bank/foods/<slug>.md`.
- `recipe show` accepts either the canonical `rcp_*` id or the stable recipe slug stored in `bank/recipes/<slug>.md`.
- `event show` accepts the canonical `evt_*` id. Specialized nouns such as `document`, `meal`, `history`, `blood-test`, and `experiment` remain the preferred follow-up surface when they already exist. `workout add`, `workout format log`, and `intervention add` intentionally return the event id and rely on `event show|list` plus generic `show|list` for follow-on reads.
- `blood-test show` accepts the canonical `evt_*` id and may also resolve the stored blood test by its title, `testName`, or `labPanelId`.
- Generic `show` accepts canonical read ids for event-backed records, including the stable `doc_*` and `meal_*` family ids. `event show` remains the explicit provenance-oriented follow-up surface when the caller needs the internal event id path, while `document manifest` and `meal manifest` expose immutable import artifacts.
- `samples batch show` and `samples batch list` are the first-class follow-up surface for `xfm_*` import-batch ids; generic `show` still does not accept them.
- `intake manifest` and `intake raw` are the first-class follow-up surface for immutable assessment evidence under `raw/assessments/**`.
- `audit show|list|tail` and `vault show|stats|repair|update` are first-class vault noun commands layered on top of the read model and core metadata write path.
- Export pack ids identify derived files under `exports/packs/`; they are not valid `show` targets.
- `sample-summary:<date>:<stream>` ids emitted by `timeline` are derived context handles, not valid `show` targets.
- A successful `show` response surfaces the canonical read id in `entity.id`.
- `device account show|reconcile|disconnect` accept the device-sync control-plane account ids returned by `device account list`; they are not canonical vault ids.

## Success Output

For non-verbose `--format json`, successful commands write the command payload directly:

```json
{
  "vault": "<path>",
  "created": true,
  "directories": ["journal/2026"],
  "files": ["CORE.md"]
}
```

Field rules:

- Success output is the command-specific payload described below, with no extra wrapper fields.
- With `--verbose --format json`, the same payload appears under `data` in incur's success envelope.
- Exit code `0` indicates success.
- The payload examples below are representative rather than exhaustive. Newer noun and mutation commands follow the same direct-payload rule and are covered by the runtime schemas in `packages/cli/src/**/*.ts`.

## Failure Output

For non-verbose `--format json`, failed commands write a direct error object and exit non-zero:

```json
{
  "code": "command_failed",
  "message": "Document import failed.",
  "retryable": false
}
```

Field rules:

- `code` is a stable string suitable for machine branching.
- `message` is operator-facing and actionable.
- `retryable` follows native `incur` semantics.
- With `--verbose --format json`, the same error shape appears under `error` in incur's envelope.

## Command Payloads

The examples below are the full successful non-verbose `--format json` response bodies.

### `init`

```json
{
  "vault": "<path>",
  "created": true,
  "directories": ["journal/2026"],
  "files": ["CORE.md"]
}
```

### `validate`

```json
{
  "vault": "<path>",
  "valid": true,
  "issues": [
    {
      "code": "missing-core",
      "path": "CORE.md",
      "message": "CORE.md is missing.",
      "severity": "error"
    }
  ]
}
```

### `document import`

```json
{
  "vault": "<path>",
  "sourceFile": "<path>",
  "rawFile": "<path>",
  "manifestFile": "<path>",
  "documentId": "doc_123",
  "eventId": "evt_123",
  "lookupId": "doc_123"
}
```

### `meal add`

```json
{
  "vault": "<path>",
  "mealId": "meal_123",
  "eventId": "evt_123",
  "lookupId": "meal_123",
  "occurredAt": "2026-03-12T09:30:00-05:00",
  "photoPath": null,
  "audioPath": null,
  "manifestFile": "<path>",
  "note": "optional note"
}
```

### `workout add`

```json
{
  "vault": "<path>",
  "eventId": "evt_123",
  "lookupId": "evt_123",
  "ledgerFile": "ledger/events/2026/2026-03.jsonl",
  "created": true,
  "occurredAt": "2026-03-12T17:30:00Z",
  "kind": "activity_session",
  "title": "20-minute strength training",
  "activityType": "strength-training",
  "durationMinutes": 20,
  "distanceKm": null,
  "workout": {
    "sessionNote": "20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.",
    "exercises": [
      {
        "name": "pushups",
        "order": 1,
        "mode": "bodyweight",
        "sets": [
          { "order": 1, "reps": 20 },
          { "order": 2, "reps": 20 },
          { "order": 3, "reps": 20 },
          { "order": 4, "reps": 20 }
        ]
      },
      {
        "name": "incline bench",
        "order": 2,
        "mode": "weight_reps",
        "note": "45 lb bar plus 10 lb plates on both sides",
        "sets": [
          { "order": 1, "reps": 12, "weight": 65, "weightUnit": "lb" },
          { "order": 2, "reps": 12, "weight": 65, "weightUnit": "lb" },
          { "order": 3, "reps": 12, "weight": 65, "weightUnit": "lb" },
          { "order": 4, "reps": 12, "weight": 65, "weightUnit": "lb" }
        ]
      }
    ]
  },
  "note": "20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides."
}
```

The freeform note is preserved verbatim in `note`. Top-level `activityType`, `durationMinutes`, and optional `distanceKm` stay as summary fields, while all rich workout detail lives under the canonical nested `workout` payload.

### `workout format save`

```json
{
  "vault": "<path>",
  "name": "Push Day A",
  "slug": "push-day-a",
  "path": "bank/workout-formats/push-day-a.md",
  "created": true
}
```

Saved workout formats are vault-local Markdown docs only. They store a reusable workout template plus optional duration, type, and distance summaries, and they are validated up front by the same inference rules that power `workout add`.

### `workout format log`

`workout format log` returns the same payload shape as `workout add`. It loads one saved format, applies any explicit CLI overrides, and then writes the same canonical `activity_session` event path.

### `intervention add`

```json
{
  "vault": "<path>",
  "eventId": "evt_123",
  "lookupId": "evt_123",
  "ledgerFile": "ledger/events/2026/2026-03.jsonl",
  "created": true,
  "occurredAt": "2026-03-12T19:30:00Z",
  "kind": "intervention_session",
  "title": "20-minute sauna",
  "interventionType": "sauna",
  "durationMinutes": 20,
  "protocolId": "prot_123",
  "note": "20 min sauna after lifting."
}
```

The freeform note is preserved verbatim in `note`. The structured fields stay intentionally small: one canonical `intervention_session` event plus one inferred or explicit `interventionType`, optional `durationMinutes`, and an optional `protocolId` link back to one therapy or habit protocol when the session should stay attached to a longer-running plan.

### `samples import-csv`

```json
{
  "vault": "<path>",
  "sourceFile": "<path>",
  "stream": "glucose",
  "importedCount": 42,
  "transformId": "xfm_123",
  "manifestFile": "<path>",
  "lookupIds": ["smp_123", "smp_124"],
  "ledgerFiles": ["<path>"]
}
```

`transformId` identifies the raw import batch only. `manifestFile` points at the immutable batch sidecar with checksum, import-config, and row provenance. Use the returned `lookupIds` or `list --kind sample` for follow-on reads.

### `experiment create`

```json
{
  "vault": "<path>",
  "experimentId": "exp_123",
  "lookupId": "exp_123",
  "slug": "sleep-window",
  "experimentPath": "<path>",
  "created": false
}
```

`created: false` is the idempotent retry case when the experiment page already exists with matching baseline attributes.

### `journal ensure`

```json
{
  "vault": "<path>",
  "date": "2026-03-12",
  "lookupId": "journal:2026-03-12",
  "journalPath": "<path>",
  "created": true
}
```

### Follow-up Read Commands

- `provider show`, `food show`, `recipe show`, `event show`, `document show`, `meal show`, `samples show`, `experiment show`, `journal show`, `intake show`, `audit show`, and `vault show` all return the same direct `entity`-style payload shape used by generic `show`, with command-local lookup behavior where documented.
- `provider list`, `food list`, `recipe list`, `event list`, `document list`, `meal list`, `samples list`, `experiment list`, `journal list`, `intake list`, `audit list`, `audit tail`, and `export pack list` all return the same direct `items` plus `filters` list payload shape used by generic `list`, but with noun-specific filter echoes.
- `document manifest`, `meal manifest`, `samples batch show`, `intake manifest`, `intake raw`, and `export pack show` return direct artifact-inspection payloads rather than generic `entity` wrappers.
- `inbox attachment list|show|show-status|parse|reparse` expose runtime attachment inspection and parser queue control over `.runtime` plus `derived/inbox/**`; they do not mutate canonical vault records.

### `show`

`entity.id` is the surfaced canonical read identity for the record. For meal/document events, that identity is the stable family id.

```json
{
  "vault": "<path>",
  "entity": {
    "id": "meal_123",
    "kind": "meal",
    "title": "Lunch bowl",
    "occurredAt": "2026-03-12T12:15:00-05:00",
    "path": "<path>",
    "markdown": "# Lunch",
    "data": {},
    "links": []
  }
}
```

### `list`

`items[].id` follows the same surfaced display-identity rule as `show`.

```json
{
  "vault": "<path>",
  "filters": {
    "recordType": ["event"],
    "kind": "meal",
    "status": null,
    "stream": [],
    "experiment": "sleep-window",
    "from": "2026-03-01",
    "to": "2026-03-12",
    "tag": ["lunch"],
    "limit": 50
  },
  "items": [
    {
      "id": "meal_123",
      "kind": "meal",
      "title": "Lunch bowl",
      "occurredAt": "2026-03-12T12:15:00-05:00",
      "path": "<path>"
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

### `search query`

`recordId` is the surfaced canonical read identity; `aliasIds` includes alternate read aliases such as the event id when that differs.

```json
{
  "vault": "<path>",
  "query": "ferritin labcorp",
  "filters": {
    "text": "ferritin labcorp",
    "recordTypes": ["event"],
    "kinds": ["document"],
    "streams": [],
    "experiment": null,
    "from": null,
    "to": null,
    "tags": ["labs"],
    "limit": 20
  },
  "total": 2,
  "hits": [
    {
      "recordId": "doc_123",
      "aliasIds": ["doc_123", "evt_123"],
      "recordType": "event",
      "kind": "document",
      "stream": null,
      "title": "Lab Report",
      "occurredAt": "2026-03-12T08:00:00Z",
      "date": "2026-03-12",
      "experimentSlug": null,
      "tags": ["labs"],
      "path": "ledger/events/2026/2026-03.jsonl",
      "snippet": "...ferritin from Labcorp...",
      "score": 21.5,
      "matchedTerms": ["ferritin", "labcorp"],
      "citation": {
        "path": "ledger/events/2026/2026-03.jsonl",
        "recordId": "doc_123",
        "aliasIds": ["doc_123", "evt_123"]
      }
    }
  ]
}
```

### `query projection status`

```json
{
  "vault": "<path>",
  "dbPath": ".runtime/projections/query.sqlite",
  "exists": true,
  "schemaVersion": "murph.query-projection.v1",
  "builtAt": "2026-04-07T03:55:00.000Z",
  "entityCount": 42,
  "searchDocumentCount": 42,
  "fresh": true
}
```

`dbPath` always reports the shared query-owned local projection at `.runtime/projections/query.sqlite`. Inbox or gateway runtime databases are separate stores and are never treated as fallbacks for query reads or lexical search.

### `query projection rebuild`

```json
{
  "vault": "<path>",
  "dbPath": ".runtime/projections/query.sqlite",
  "exists": true,
  "schemaVersion": "murph.query-projection.v1",
  "builtAt": "2026-04-07T03:55:00.000Z",
  "entityCount": 42,
  "searchDocumentCount": 42,
  "fresh": true,
  "rebuilt": true
}
```

### `timeline`

```json
{
  "vault": "<path>",
  "filters": {
    "from": "2026-03-12",
    "to": "2026-03-12",
    "experiment": null,
    "kinds": [],
    "streams": [],
    "entryTypes": [],
    "limit": 200
  },
  "items": [
    {
      "id": "sample-summary:2026-03-12:heart_rate",
      "entryType": "sample_summary",
      "occurredAt": "2026-03-12T20:00:00Z",
      "date": "2026-03-12",
      "title": "heart_rate daily summary",
      "kind": "sample_summary",
      "stream": "heart_rate",
      "experimentSlug": null,
      "path": "ledger/samples/heart_rate/2026/2026-03.jsonl",
      "relatedIds": ["smp_123", "smp_124"],
      "tags": ["sample_summary", "heart_rate"],
      "data": {
        "stream": "heart_rate",
        "sampleCount": 2,
        "averageValue": 69
      }
    }
  ]
}
```

### `export pack create`

```json
{
  "vault": "<path>",
  "from": "2026-03-01",
  "to": "2026-03-12",
  "experiment": "sleep-window",
  "outDir": "<path>",
  "packId": "pack-2026-03-01-2026-03-12-sleep-window",
  "files": [
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/manifest.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/question-pack.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/records.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/daily-samples.json",
    "exports/packs/pack-2026-03-01-2026-03-12-sleep-window/assistant-context.md"
  ]
}
```

Export packs are derived outputs and do not create canonical vault records.
The five-file pack shape stays stable; health extensions enrich `manifest.json`, `question-pack.json`, and `assistant-context.md` with assessments, profile snapshots/current profile, health history, and registry context while keeping `records.json` as the main exported records array.

## Boundary Rules

- `init`, `validate`, `meal add`, `document import`, `samples import-csv`, and `intake import` delegate to `packages/core` or `packages/importers` write paths that preserve immutable raw evidence and append-only ledgers.
- `provider upsert`, `food upsert`, `food schedule`, `recipe upsert`, `event upsert`, `samples add`, `workout add`, `workout format save|show|list|log`, `intervention add`, `experiment create|update|checkpoint|stop`, `journal ensure|append|link|unlink`, `vault repair|update`, `intake project`, health `<noun> scaffold`, health `<noun> upsert`, `profile current rebuild`, `protocol stop`, and `supplement stop` all delegate to `packages/core` exports or to CLI-local helpers built only on top of `packages/core` frontmatter/jsonl primitives, importer entrypoints, canonical write locks, and assistant runtime automation state.
- `show`, `list`, `search query`, `query projection status|rebuild`, `timeline`, `document/meal/samples/intake/export` follow-up reads, `audit show|list|tail`, and `vault show|stats` delegate to the read model plus immutable-manifest inspection helpers.
- `inbox` bootstrap/setup, capture review, attachment parse, and promote commands delegate to `packages/inboxd`, `packages/parsers`, and shared `packages/core` primitives without directly writing arbitrary vault files from the CLI layer.
- Contract validation errors normalize to the shared codes in `docs/contracts/04-error-codes.md`.
- The default CLI service layer is expected to delegate to the real `core`, `importers`, and `query` package exports. If the local TypeScript or `incur` toolchain is unavailable, that is an environment blocker, not a contract excuse to return placeholder payloads.
