# Command Surface

Status: frozen baseline plus health extension fence for `murph` and `vault-cli`

## Namespace

- `murph` is the product CLI. It uses the selected active vault for normal commands, `murph onboard --vault <path>` creates or selects one during setup, and `murph use <path>` selects an existing vault for future product commands.
- `vault-cli` is the raw explicit-vault and operator surface. The command synopses below list that explicit-vault contract because every canonical vault command names its target with `--vault <path>`.
- `murph` and `vault-cli` are two UX layers over the same command graph; product aliases such as `murph chat`, `murph run`, `murph status`, `murph doctor`, and `murph stop` must stay discovery-compatible with their explicit-vault equivalents.
- `packages/cli` owns command registration, schema validation, and delegation into `core`, `importers`, and `query`.
- `device` commands delegate to the local `@murphai/device-syncd` control plane for provider OAuth/account actions while leaving canonical health writes behind the existing importer/core boundary, and the CLI may start or reuse that local daemon for the selected vault when no explicit control-plane target is provided.
- Native `incur` owns the transport envelope and human-oriented formatting behavior.
- `packages/cli` must not write vault files directly. Write commands delegate to `packages/core` or `packages/importers`; read commands delegate to `packages/query`.
- Canonical write commands run through the core mutation runtime, which acquires declared canonical file resources before any read-modify-write work begins. Commands may overlap only when those declared resources are disjoint; singleton documents and shared monthly ledger or audit shards still serialize by design.
- `vault repair-experiment-media` dry-runs by default and mutates only with explicit command-line `--apply`. It promotes a supported misplaced media file through the canonical capture owner only when the boundary-safe, byte-exact full source path appears in exactly one direct canonical experiment document. Basenames, relative or encoded paths, substrings, case or Unicode normalization variants, residual alternate spellings, and multiple-document owners do not qualify. The command verifies every event, attachment, raw manifest, and copied byte; replaces only the proved full-path literals with the canonical capture path; then atomically quarantines and verifies the inspected note and legacy media before replacement or deletion. Concurrent edits and unsupported, unassociated, multiply-associated, ambiguous-reference, symlink, special, or conflicting files block apply without losing their bytes.
- `vault repair-inbox-envelopes` dry-runs by default and mutates only with explicit command-line `--apply`. It appends an exactly equivalent current inbox-capture record and receipt-guard deletes the redundant legacy raw envelope in the same canonical batch. Invalid or duplicate ledger ownership, byte/schema mismatches, and nonterminal operations block the bounded pass.
- `vault compact-inbox-parser-attempts` dry-runs by default and mutates only with explicit command-line `--apply`. It reconstructs one versioned parser result bundle from an exact legacy attempt, verifies identity, paths, schema, and semantic equality, then deletes only the proved sidecars. Concurrent apply runs publish a previously absent `result.json` with exclusive atomic creation, never overwrite a competing result, and never roll back a valid published result after another process may have consumed it; a later pass converges any partial legacy deletion. Apply is bounded to 100 eligible attempts; conflicts, incomplete attempts, symlinks, and unexpected entries remain untouched and are reported as counts.
- `vault repair-junction-hr-zones` dry-runs by default and mutates only with explicit `--apply`. It repairs Junction workout rows from any source provider only when the candidate's rawRefs contain a Junction record whose heart-rate zones are a dense six-element primitive numeric array (numbers or numeric strings) whose seconds-to-minutes conversion equals each stored `durationMinutes`, AND that record either carries the same source provider inline OR is the only duration-matching same-id record with no inline provider — the latter exists for legacy connection-resolved imports whose `connectionId`/`sourceId` was stripped during raw sanitization. Any same-id raw record with a different inline provider, with non-primitive `hr_zones`, or with primitive zones whose durations do not match the stored row counts as ambiguity and disqualifies the repair. Candidate ids that also appear on schema-invalid ledger rows are refused, since a rejected row may be the actual latest revision and shadowing it would append over stale state. Normalized `1..6` rows without that proof are reported as `unverifiedCandidateCount` and skipped. Sparse legacy imports (six-slot arrays with `null` entries that were compacted into fewer-than-six stored zones) are intentionally out of scope: re-importing the affected workout is the supported recovery path.

## Command Groups

```text
vault-cli init --vault <path> [--request-id <id>]
vault-cli validate --vault <path> [--request-id <id>]
vault-cli vault show --vault <path> [--request-id <id>]
vault-cli vault stats --vault <path> [--request-id <id>]
vault-cli vault repair --vault <path> [--request-id <id>]
vault-cli vault repair-experiment-media --vault <path> [--dry-run] [--apply] [--request-id <id>]
vault-cli vault repair-inbox-envelopes --vault <path> [--dry-run] [--apply] [--max-files <count>] [--request-id <id>]
vault-cli vault compact-inbox-parser-attempts --vault <path> [--dry-run] [--apply] [--max-attempts <count>] [--request-id <id>]
vault-cli vault repair-junction-hr-zones --vault <path> [--dry-run] [--apply] [--request-id <id>]
vault-cli vault update --vault <path> [--title <title>] [--timezone <tz>] [--request-id <id>]
vault-cli audit show <id> --vault <path> [--request-id <id>]
vault-cli audit list --vault <path> [--action <action>] [--actor <actor>] [--status <status>] [--from <date>] [--to <date>] [--sort asc|desc] [--limit <n>] [--request-id <id>]
vault-cli audit tail --vault <path> [--limit <n>] [--request-id <id>]
vault-cli chat [prompt] --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--thread <id>] [--codexCommand <path>] [--codexHome <path>] [--model <model>] [--modelProvider <id>] [--reasoningEffort low|medium|high|xhigh] [--sandbox read-only|workspace-write|danger-full-access] [--approvalPolicy never] [--profile <name>] [--request-id <id>]
vault-cli run --vault <path> [--maxPerScan <n>] [--allowSelfAuthored] [--sessionRolloverHours <hours>] [--once] [--request-id <id>]
vault-cli knowledge upsert --vault <path> --body <markdown> [--title <title>] [--slug <slug>] [--page-type <type>] [--status <status>] [--clear-library-links] [--library-slug <slug> ...] [--related-slug <slug> ...] [--source-path <path> ...] [--request-id <id>]
vault-cli knowledge append-section <slug> <heading> --vault <path> --body <markdown> [--title <title>] [--position prepend|append] [--source-path <path> ...] [--request-id <id>]
vault-cli knowledge list --vault <path> [--page-type <type>] [--status <status>] [--request-id <id>]
vault-cli knowledge search <query> --vault <path> [--page-type <type>] [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli knowledge show <slug> --vault <path> [--request-id <id>]
vault-cli knowledge lint --vault <path> [--request-id <id>]
vault-cli knowledge log tail --vault <path> [--limit <n>] [--request-id <id>]
vault-cli knowledge index rebuild --vault <path> [--request-id <id>]
vault-cli assistant ask <prompt> --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--thread <id>] [--codexCommand <path>] [--codexHome <path>] [--model <model>] [--modelProvider <id>] [--reasoningEffort low|medium|high|xhigh] [--sandbox read-only|workspace-write|danger-full-access] [--approvalPolicy never] [--profile <name>] [--deliverResponse] [--deliveryTarget <target>] [--request-id <id>]
vault-cli assistant chat [prompt] --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--thread <id>] [--codexCommand <path>] [--codexHome <path>] [--model <model>] [--modelProvider <id>] [--reasoningEffort low|medium|high|xhigh] [--sandbox read-only|workspace-write|danger-full-access] [--approvalPolicy never] [--profile <name>] [--request-id <id>]
vault-cli assistant deliver <message> --vault <path> [--session <id>] [--alias <alias>] [--channel <channel>] [--identity <id>] [--participant <id>] [--thread <id>] [--deliveryTarget <target>] [--request-id <id>]
vault-cli assistant status --vault <path> [--session <id>] [--limit <n>] [--request-id <id>]
vault-cli assistant doctor --vault <path> [--repair] [--request-id <id>]
vault-cli assistant run --vault <path> [--maxPerScan <n>] [--allowSelfAuthored] [--sessionRolloverHours <hours>] [--once] [--request-id <id>]
vault-cli assistant stop --vault <path> [--request-id <id>]
vault-cli status --vault <path> [--session <id>] [--limit <n>] [--request-id <id>]
vault-cli doctor --vault <path> [--repair] [--request-id <id>]
vault-cli stop --vault <path> [--request-id <id>]
vault-cli assistant session list --vault <path> [--limit <n>] [--request-id <id>]
vault-cli assistant session show <sessionId> --vault <path> [--request-id <id>]
vault-cli memory show [memoryId] --vault <path>
vault-cli memory set-name <displayName> --vault <path>
vault-cli memory upsert <text> --vault <path> --section <section>
vault-cli memory update <memoryId> <text> --vault <path> [--section <section>]
vault-cli memory forget <memoryId> --vault <path>
vault-cli automation scaffold --vault <path>
vault-cli automation save <title> --vault <path> --instructions <text> --schedule-kind <kind> [--channel <channel>] [...]
vault-cli automation show <lookup> --vault <path>
vault-cli automation list --vault <path> [--status <status> ...] [--text <query>] [--limit <n>]
vault-cli automation import-json --vault <path> --input @payload.json|-
vault-cli device provider list --vault <path> [--baseUrl <url>]
vault-cli device connect <target> --vault <path> [--baseUrl <url>] [--returnTo <url>] [--open]
vault-cli device account list --vault <path> [--baseUrl <url>] [--provider <provider>]
vault-cli device account show <accountId> --vault <path> [--baseUrl <url>]
vault-cli device account reconcile <accountId> --vault <path> [--baseUrl <url>]
vault-cli device account disconnect <accountId> --vault <path> [--baseUrl <url>]
vault-cli device daemon status --vault <path> [--baseUrl <url>]
vault-cli device daemon start --vault <path> [--baseUrl <url>]
vault-cli device daemon stop --vault <path> [--baseUrl <url>]
vault-cli commons protocol list [--query <query>] [--category <category>] [--limit <n>]
vault-cli commons protocol show <key-or-slug>
vault-cli commons protocol explore <query> [--limit <n>]
vault-cli provider scaffold --vault <path> [--request-id <id>]
vault-cli provider import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli provider show <id> --vault <path> [--request-id <id>]
vault-cli provider list --vault <path> [--status active|inactive] [--limit <n>] [--request-id <id>]
vault-cli provider edit <id> --vault <path> [--title <title>] [--slug <slug>] [--status <status>] [--specialty <text>] [--organization <text>] [--location <text>] [--website <url>] [--phone <text>] [--note <text>] [--alias <text> ...] [--body <markdown>] [--clear-specialty] [--clear-organization] [--clear-location] [--clear-website] [--clear-phone] [--clear-note] [--clear-aliases] [--clear-body] [--request-id <id>]
vault-cli food scaffold --vault <path> [--request-id <id>]
vault-cli food import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli food edit <id> --vault <path> [--title <title>] [--slug <slug>] [--status active|archived] [--summary <text>] [--kind <text>] [--brand <text>] [--vendor <text>] [--location <text>] [--serving <text>] [--calories <n>] [--protein-grams <n>] [--carbs-grams <n>] [--fat-grams <n>] [--fiber-grams <n>] [--nutrition-source <source>] [--nutrition-confidence <level>] [--nutrition-source-detail <text>] [--alias <text> ...] [--ingredient <text> ...] [--tag <tag> ...] [--note <text>] [--auto-log-daily-time <HH:MM>] [--attached-regimen-id <id> ...] [--link-related-regimen-id <id> ...] [--clear-summary] [--clear-kind] [--clear-brand] [--clear-vendor] [--clear-location] [--clear-serving] [--clear-nutrition] [--clear-aliases] [--clear-ingredients] [--clear-tags] [--clear-note] [--clear-auto-log-daily] [--clear-attached-regimen-ids] [--clear-links] [--request-id <id>]
vault-cli food rename <id> --vault <path> --title <title> [--slug <slug>] [--request-id <id>]
vault-cli food schedule <title> --vault <path> --time <HH:MM> [--note <text>] [--slug <slug>] [--request-id <id>]
vault-cli food unschedule <id> --vault <path> [--request-id <id>]
vault-cli food show <id> --vault <path> [--request-id <id>]
vault-cli food list --vault <path> [--status active|archived] [--limit <n>] [--request-id <id>]
vault-cli recipe scaffold --vault <path> [--request-id <id>]
vault-cli recipe import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli recipe edit <id> --vault <path> [--title <title>] [--slug <slug>] [--status draft|saved|archived] [--summary <text>] [--cuisine <text>] [--dish-type <text>] [--source <text>] [--servings <n>] [--prep-time-minutes <n>] [--cook-time-minutes <n>] [--total-time-minutes <n>] [--tag <tag> ...] [--ingredient <text> ...] [--step <text> ...] [--related-goal-id <id> ...] [--related-condition-id <id> ...] [--link <type:targetId> ...] [--clear-summary] [--clear-cuisine] [--clear-dish-type] [--clear-source] [--clear-servings] [--clear-prep-time] [--clear-cook-time] [--clear-total-time] [--clear-tags] [--clear-ingredients] [--clear-steps] [--clear-related-goal-ids] [--clear-related-condition-ids] [--clear-links] [--request-id <id>]
vault-cli recipe show <id> --vault <path> [--request-id <id>]
vault-cli recipe list --vault <path> [--status draft|saved|archived] [--limit <n>] [--request-id <id>]
vault-cli event scaffold --vault <path> --kind <kind> [--request-id <id>]
vault-cli event import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli event import-jsonl --vault <path> --input @file.jsonl|- [--apply] [--request-id <id>]
vault-cli event payload-schema --for import-jsonl --kind <kind>
vault-cli event note add --vault <path> --note <text> [--title <title>] [--occurred-at <ts>] [--source <source>] [--tag <tag> ...] [--request-id <id>]
vault-cli event symptom add --vault <path> --symptom <name> --severity <0-10> [--body-region <text>] [--title <title>] [--occurred-at <ts>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event observation add --vault <path> --metric <slug> --value <number> --unit <unit> [--title <title>] [--occurred-at <ts>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event medication-intake add --vault <path> --medication-name <name> --dose <number> --unit <unit> [--title <title>] [--occurred-at <ts>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event supplement-intake add --vault <path> --supplement-name <name> --dose <number> --unit <unit> [--title <title>] [--occurred-at <ts>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event encounter add --vault <path> --encounter-type <type> --occurred-at <ts> [--location <text>] [--provider-id <providerId>] [--title <title>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event procedure add --vault <path> --procedure <name> --occurred-at <ts> [--status ordered|planned|completed|cancelled] [--title <title>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event adverse-effect add --vault <path> --substance <text> --effect <text> --occurred-at <ts> [--severity mild|moderate|severe] [--title <title>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event exposure add --vault <path> --exposure-type <type> --substance <text> --occurred-at <ts> [--duration <text>] [--title <title>] [--source <source>] [--note <text>] [--tag <tag> ...] [--request-id <id>]
vault-cli event edit <id> --vault <path> [--kind <kind>] [--title <title>] [--note <text>] [--occurred-at <ts>] [--time-zone <zone>] [--day-key <YYYY-MM-DD>] [--source <source>] [--tag <tag> ...] [--clear-title] [--clear-note] [--clear-time-zone] [--clear-day-key] [--clear-source] [--clear-tags] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli event show <id> --vault <path> [--request-id <id>]
vault-cli event list --vault <path> [--kind <kind>] [--from <date>] [--to <date>] [--tag <tag> ...] [--experiment <slug>] [--limit <n>] [--request-id <id>]
vault-cli document import <file> --vault <path> [--title <title>] [--occurred-at <ts>] [--note "..."] [--source <source>] [--request-id <id>]
vault-cli document edit <id> --vault <path> [--title <title>] [--note <text>] [--occurred-at <ts>] [--time-zone <zone>] [--day-key <YYYY-MM-DD>] [--source <source>] [--tag <tag> ...] [--clear-title] [--clear-note] [--clear-time-zone] [--clear-day-key] [--clear-source] [--clear-tags] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli document show <id> --vault <path> [--request-id <id>]
vault-cli document list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli document manifest <id> --vault <path> [--request-id <id>]
vault-cli capture add --vault <path> [--media <path> ...] [--label <text>] [--body-site <text>] [--collection <text>] [--related-id <id> ...] [--note <text>] [--title <title>] [--occurred-at <ts>] [--source <source>] [--tag <tag> ...] [--request-id <id>]
vault-cli capture import-json --vault <path> --input @file.json|- [--request-id <id>]
vault-cli capture show <id-or-label> --vault <path> [--request-id <id>]
vault-cli capture list --vault <path> [--from <date>] [--to <date>] [--label <text>] [--body-site <text>] [--collection <text>] [--tag <tag> ...] [--limit <n>] [--request-id <id>]
vault-cli capture manifest <id-or-label> --vault <path> [--request-id <id>]
vault-cli meal add --vault <path> [--input @file.json|-] [--photo <path>] [--audio <path>] [--note "..."] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli meal edit <id> --vault <path> [--title <title>] [--note <text>] [--occurred-at <ts>] [--time-zone <zone>] [--day-key <YYYY-MM-DD>] [--source <source>] [--tag <tag> ...] [--ingredient <text> ...] [--nutrition-calories <n>] [--nutrition-protein-grams <n>] [--nutrition-carbs-grams <n>] [--nutrition-fat-grams <n>] [--nutrition-fiber-grams <n>] [--nutrition-source <source>] [--nutrition-confidence <level>] [--nutrition-source-detail <text>] [--clear-title] [--clear-note] [--clear-time-zone] [--clear-day-key] [--clear-source] [--clear-tags] [--clear-ingredients] [--clear-nutrition] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli meal show <id> --vault <path> [--request-id <id>]
vault-cli meal list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli measurement add --vault <path> [--metric <name> ...] [--value <number> ...] [--unit <unit> ...] [--qualifier <key=value> ...] [--measurement-note <text> ...] [--media <path> ...] [--note <text>] [--title <title>] [--occurred-at <ts>] [--source <source>] [--tag <tag> ...] [--request-id <id>]
vault-cli measurement import-json --vault <path> --input @file.json|- [--request-id <id>]
vault-cli measurement show <id> --vault <path> [--request-id <id>]
vault-cli measurement list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli measurement manifest <id> --vault <path> [--request-id <id>]
vault-cli assertion scaffold --vault <path>
vault-cli assertion save --vault <path> --assertion <type> [--domain <domain>] [--polarity <polarity>] [--subject <text>] [--assertion-text <text>] [--asserted-on <YYYY-MM-DD>] [--occurred-at <ts>] [--source <source>] [--title <title>] [--note <text>] [--source-label <text>]
vault-cli assertion import-json --vault <path> --input @file.json|-
vault-cli assertion payload-schema
vault-cli vitals scaffold --vault <path>
vault-cli vitals save --vault <path> [--systolic <n>] [--diastolic <n>] [--heart-rate <n>] [--respiratory-rate <n>] [--temperature-f <n>] [--temperature-c <n>] [--spo2 <n>] [--weight-lb <n>] [--height-in <n>] [--occurred-at <ts>] [--source <source>] [--title <title>] [--note <text>]
vault-cli vitals import-json --vault <path> --input @file.json|-
vault-cli vitals payload-schema
vault-cli diagnostic-test scaffold --vault <path>
vault-cli diagnostic-test save <testName> --vault <path> [--result-status <status>] [--summary <text>] [--test-category <text>] [--specimen-type <text>] [--lab-name <text>] [--reported-at <ts>] [--occurred-at <ts>] [--source <source>] [--title <title>] [--note <text>]
vault-cli diagnostic-test import-json --vault <path> --input @file.json|-
vault-cli diagnostic-test payload-schema
vault-cli clinical-note scaffold --vault <path>
vault-cli clinical-note import-json --vault <path> --input @file.json|-
vault-cli clinical-note payload-schema
vault-cli social-history scaffold --vault <path>
vault-cli social-history import-json --vault <path> --input @file.json|-
vault-cli social-history payload-schema
vault-cli encounter scaffold --vault <path> [--request-id <id>]
vault-cli encounter import-json --vault <path> --input @file.json|- [--request-id <id>]
vault-cli encounter payload-schema
vault-cli workout add <text> --vault <path> [--duration <minutes>] [--type <type>] [--distance-km <km>] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli workout import-json --vault <path> --input @file.json|- [--duration <minutes>] [--type <type>] [--distance-km <km>] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli workout payload-schema
vault-cli workout import inspect <file> --vault <path> [--source strong|hevy] [--delimiter <char>] [--weight-unit lb|kg] [--distance-unit m|km|mi]
vault-cli workout import csv <file> --vault <path> [--source strong|hevy] [--delimiter <char>] [--weight-unit lb|kg] [--distance-unit m|km|mi] [--store-raw-only] [--correct-units]
vault-cli workout edit <id> --vault <path> [--title <title>] [--note <text>] [--occurred-at <ts>] [--time-zone <zone>] [--day-key <YYYY-MM-DD>] [--source <source>] [--tag <tag> ...] [--duration <minutes>] [--type <type>] [--distance-km <km>] [--workout-source-app <slug>] [--workout-source-workout-id <id>] [--workout-started-at <ts>] [--workout-ended-at <ts>] [--workout-routine-id <id>] [--workout-routine-name <text>] [--workout-session-note <text>] [--workout-media <fields> ...] [--workout-exercise <fields> ...] [--workout-set <fields> ...] [--clear-title] [--clear-note] [--clear-time-zone] [--clear-day-key] [--clear-source] [--clear-tags] [--clear-duration] [--clear-distance] [--clear-workout] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli workout format save <name> <text> --vault <path> [--duration <minutes>] [--type <type>] [--distance-km <km>] [--request-id <id>]
vault-cli workout format show <name> --vault <path> [--request-id <id>]
vault-cli workout format list --vault <path> [--limit <n>] [--request-id <id>]
vault-cli workout format log <name> --vault <path> [--duration <minutes>] [--type <type>] [--distance-km <km>] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli intervention add <text> --vault <path> [--duration <minutes>] [--type <type>] [--regimen-id <regimenId>] [--experiment <slug-or-id>] [--skip-experiment-link] [--allow-out-of-window] [--occurred-at <ts>] [--source <source>] [--request-id <id>]
vault-cli intervention edit <id> --vault <path> [--title <title>] [--note <text>] [--occurred-at <ts>] [--time-zone <zone>] [--day-key <YYYY-MM-DD>] [--source <source>] [--tag <tag> ...] [--type <type>] [--duration <minutes>] [--regimen-id <id>] [--clear-title] [--clear-note] [--clear-time-zone] [--clear-day-key] [--clear-source] [--clear-tags] [--clear-duration] [--clear-regimen-id] [--day-key-policy keep|recompute] [--request-id <id>]
vault-cli meal manifest <id> --vault <path> [--request-id <id>]
vault-cli samples add --vault <path> --stream <stream> --unit <unit> --recorded-at <ts> [--value <number>] [--source <source>] [--quality <quality>] [--stage <stage>] [--start-at <ts>] [--end-at <ts>] [--duration-minutes <n>] [--source-path <path>] [--batch-source-file-name <name>] [--batch-preset-id <id>] [--batch-delimiter <char>] [--batch-timestamp-column <name>] [--batch-value-column <name>] [--batch-metadata-columns <name> ...] [--request-id <id>]
vault-cli samples import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli samples import-csv <file> --vault <path> [--preset <id>] [--stream <stream>] [--ts-column <name>] [--value-column <name>] [--unit <unit>] [--delimiter <char>] [--metadata-columns <name> ...] [--source <source>] [--request-id <id>]
vault-cli samples csv profile <file> --vault <path> [--preset <id>] [--stream <stream>] [--ts-column <name>] [--value-column <name>] [--unit <unit>] [--delimiter <char>] [--metadata-columns <name> ...] [--source <source>] [--include-summary] [--summary-profile oxygen-night] [--threshold-below <n> ...] [--gap-seconds <n>] [--request-id <id>]
vault-cli samples csv import <file> --vault <path> [--preset <id>] [--stream <stream>] [--ts-column <name>] [--value-column <name>] [--unit <unit>] [--delimiter <char>] [--metadata-columns <name> ...] [--source <source>] [--request-id <id>]
vault-cli samples summarize --vault <path> --stream <stream> [--from <ts>] [--to <ts>] [--profile oxygen-night] [--threshold-below <n> ...] [--gap-seconds <n>] [--request-id <id>]
vault-cli samples show <id> --vault <path> [--request-id <id>]
vault-cli samples list --vault <path> [--stream <stream>] [--from <date>] [--to <date>] [--quality <quality>] [--limit <n>] [--request-id <id>]
vault-cli samples batch show <id> --vault <path> [--request-id <id>]
vault-cli samples batch list --vault <path> [--stream <stream>] [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli experiment start <slug> --vault <path> (--from-protocol <key-or-route> | --custom) [--test-plan-id <id>] [--page-revision-id sha256:<64-hex>] [--run-spec-revision-id sha256:<64-hex>] [--title <title>] [--hypothesis <text>] [--started-on <date>] [--status <status>] [--intervention-start <date>] [--intervention-end <date>] [--baseline-start <date>] [--baseline-end <date>] [--baseline-days <n>] [--intervention-days <n>] [--schedule-kind dailyLocal|cron] [--schedule-local-time <HH:MM>] [--schedule-cron <expr>] [--schedule-time-zone <zone>] [--dose <text>] [--session-field <id> ...] [--primary-biomarker-key biomarker:<key>] [--secondary-biomarker-key biomarker:<key> ...] [--analysis-anchor role=baseline,kind=lab_panel,recordId=evt_...,biomarkerKeys=biomarker:<key> ...] [--planned-measurement role=followup,kind=lab_panel,window=<date>..<date>,biomarkerKeys=biomarker:<key> ...] [--dry-run] [--request-id <id>]
vault-cli experiment show <id> --vault <path> [--request-id <id>]
vault-cli experiment list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli experiment edit <id> --vault <path> [--title <title>] [--hypothesis <text>] [--started-on <date>] [--status <status>] [--body <markdown>] [--tag <tag> ...] [--protocol-key protocol_variant:<key>] [--page-revision-id sha256:<64-hex>] [--run-spec-revision-id sha256:<64-hex>] [--test-plan-id <id>] [--baseline-days <n>] [--intervention-days <n>] [--intervention-start <date>] [--schedule-kind dailyLocal|cron] [--schedule-local-time <HH:MM>] [--schedule-cron <expr>] [--schedule-time-zone <zone>] [--dose <text>] [--session-field <id> ...] [--analysis-anchor role=baseline,kind=lab_panel,recordId=evt_...,biomarkerKeys=biomarker:<key> ...] [--planned-measurement role=followup,kind=lab_panel,window=<date>..<date>,biomarkerKeys=biomarker:<key> ...] [--setup-answer <id=value> ...] [--reminder-policy <id>] [--missed-log-followup <policy>] [--request-id <id>]
vault-cli experiment checkpoint <lookup> --vault <path> [--occurred-at <ts>] [--title <title>] [--note <text>] [--request-id <id>]
vault-cli experiment stop <id> --vault <path> [--occurred-at <ts>] [--note "..."] [--request-id <id>]
vault-cli experiment session log <lookup> --vault <path> [--occurred-at <ts>] [--source <source>] [--title <title>] [--note <text>] [--intervention-type <type>] [--status completed|partial|missed|skipped] [--session-status completed|partial|missed|skipped] [--duration-minutes <n>] [--protocol-id <id>] [--timing <text>] [--temperature-c <number>] [--after-exercise] [--symptoms <text> ...] [--confounders <text> ...] [--confounder <key=value> ...] [--request-id <id>]
vault-cli experiment session attach <lookup> <eventId> --vault <path> [--replace] [--allow-out-of-window] [--request-id <id>]
vault-cli experiment session detach <eventId> --vault <path> [--request-id <id>]
vault-cli experiment context log <lookup> --vault <path> [--kind experiment_context|note|supplement_intake] [--occurred-at <ts>] [--source <source>] [--title <title>] [--note <text>] [--context-type <slug>] [--severity info|potential_confounder|safety|blocking] [--tag <tag> ...] [--supplement-name <name>] [--dose <number>] [--unit <unit>] [--request-id <id>]
vault-cli experiment followup due <id> --vault <path> --kind missed-log|weekly-digest [--date <YYYY-MM-DD>] [--request-id <id>]
vault-cli journal ensure <date> --vault <path> [--request-id <id>]
vault-cli journal show <date> --vault <path> [--request-id <id>]
vault-cli journal list --vault <path> [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli journal append <date> --vault <path> --text "..." [--request-id <id>]
vault-cli journal link <date> --vault <path> [--event-id <evt_*> ...] [--stream <stream> ...] [--request-id <id>]
vault-cli journal unlink <date> --vault <path> [--event-id <evt_*> ...] [--stream <stream> ...] [--request-id <id>]
vault-cli show <id> --vault <path> [--request-id <id>]
vault-cli list --vault <path> [--record-type <type> ...] [--kind <kind>] [--status <status>] [--stream <stream> ...] [--tag <tag> ...] [--experiment <slug>] [--from <date>] [--to <date>] [--limit <n>] [--request-id <id>]
vault-cli search query <query> --vault <path> [--record-type <type> ...] [--kind <kind> ...] [--stream <stream> ...] [--experiment <slug>] [--from <date>] [--to <date>] [--tag <tag> ...] [--limit <n>] [--request-id <id>]
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
vault-cli intake project <id> --vault <path> [--request-id <id>]
vault-cli regimen import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli regimen save <title> --vault <path> --kind medication|supplement|therapy|habit [--id <regimenId>] [--slug <slug>] [--status <status>] [--started-on <date>] [--stopped-on <date>] [--schedule <text>] [--brand <text>] [--manufacturer <text>] [--serving-size <text>] [--note <text>] [--substance <text>] [--dose <number>] [--unit <unit>] [--group <text>] [--ingredient-compound <text>] [--ingredient-label <text>] [--ingredient-amount <number>] [--ingredient-unit <unit>] [--ingredient-active] [--ingredient-note <text>] [--related-goal-id <id> ...] [--related-condition-id <id> ...] [--related-regimen-id <id> ...] [--request-id <id>]
vault-cli regimen stop <regimenId> --vault <path> [--stopped-on <date>] [--request-id <id>]
vault-cli regimen show <id> --vault <path> [--request-id <id>]
vault-cli regimen list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli medication history add <title> --vault <path> --started-on <date> [--id <regimenId>] [--slug <slug>] [--stopped-on <date>] [--schedule <text>] [--substance <text>] [--dose <number>] [--unit <unit>] [--group <text>] [--note <text>] [--related-goal-id <id> ...] [--related-condition-id <id> ...] [--related-regimen-id <id> ...] [--request-id <id>]
vault-cli protocol import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli protocol show <id> --vault <path> [--request-id <id>]
vault-cli protocol list --vault <path> [--commons-protocol <key-or-slug>] [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli supplement save <title> --vault <path> [--id <regimenId>] [--slug <slug>] [--status <status>] [--started-on <date>] [--stopped-on <date>] [--schedule <text>] [--group <text>] [--substance <text>] [--dose <number>] [--dose-unit <unit>] [--brand <text>] [--manufacturer <text>] [--serving-size <text>] [--ingredient <json> ...] [--related-goal-id <id> ...] [--related-condition-id <id> ...] [--related-regimen-id <id> ...] [--request-id <id>]
vault-cli supplement show <id> --vault <path> [--request-id <id>]
vault-cli supplement list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli supplement stop <regimenId> --vault <path> [--stopped-on <date>] [--request-id <id>]
vault-cli supplement compound list --vault <path> [--status <status>] [--limit <n>] [--request-id <id>]
vault-cli supplement compound show <compound> --vault <path> [--status <status>] [--request-id <id>]
```

`medication history add` is a medication-only facade over the private regimen registry for completed courses copied from records. It creates `kind: medication` regimen records, defaults to `status: completed` and `group: medication/history`, and uses a date-qualified slug derived from the title plus `startedOn`/`stoppedOn` so repeated historical courses do not collide or become active regimens or point-in-time intake events. Current medication creation and updates stay on `regimen save --kind medication`.

`encounter import-json` JSON payloads must include a stable canonical `eventId` for
the encounter and every child measurement, procedure, or test. Retrying the
same import payload then fails on the existing id instead of appending duplicate
clinical facts under new generated ids.

The clinical import facades above are intentionally storage-thin. `assertion`
writes canonical `clinical_assertion` events, `vitals` writes canonical
`measurement` events, `diagnostic-test` writes canonical `test` events,
`clinical-note` writes canonical `note` events with structured note metadata,
and `social-history` imports entries into canonical `clinical_assertion`,
`exposure`, or tagged `note` events through validated event batches. File-backed clinical import-json
payloads require stable `externalRef` values and reject explicit `eventId`; retries reconcile by
externalRef instead of appending duplicate facts. Social-history entries require
per-entry `externalRef` values so retries reconcile through the batch importer instead of appending
duplicates, and those refs must be unique by `system`, `resourceType`, `resourceId`, and `facet`
within one payload because `version` is not part of retry identity. Only `current` and `former` entries in exposure categories become exposure events;
`unknown` or omitted-status entries remain tagged notes, while denial-style statuses become
clinical assertions. An all-skipped idempotent retry returns empty `eventIds` and omits `lookupId`;
normal writes include `lookupId` for the first created event. Each import surface exposes
`payload-schema` so agents can generate the file body from the exact writable
JSON contract, then use `scaffold` only as an example payload.

No `vault-cli inbox` command family is exposed. Inbox projection and audio/video parsing are programmatic runtime services; assistant turns receive prompt-ready attachment descriptors and raw local paths, then use local tools for inspectable files such as PDFs, CSVs, and documents.

Patch-style edit commands (`event`, `document`, `meal`, `workout`, `intervention`, `provider`, `food`, `recipe`) are typed surfaces. They do not expose `edit --input`, `edit --set`, or `edit --clear`; advanced whole-record JSON import remains on the explicit `import-json` commands where present.

For event-backed edit commands (`event`, `document`, `meal`, `workout`, `intervention`), changing `occurredAt` or `timeZone` without setting `dayKey` directly now requires `--day-key-policy keep|recompute`. This prevents silent stale-day retention and prevents legacy records without explicit `timeZone` provenance from silently materializing the vault default timezone into the saved record during edits.

`vault-cli assistant ask|chat|deliver|status|doctor|run|stop|session` persist or inspect assistant runtime state only. Durable user-facing memory is managed through the top-level canonical `memory` noun backed by `bank/memory.md`, and durable scheduled assistant prompts are managed through the top-level canonical `automation` noun backed by `bank/automations/*.md`. Accepted inbound assistant-automation captures may still auto-preserve stored document attachments into the canonical document import surface before reply behavior runs, while leaving the original inbox capture evidence in place under `raw/inbox/**`. Coarse system-written turn receipts, replay-safe outbox intents, diagnostics snapshots, persisted status snapshots, and other assistant runtime artifacts live under `vault/.runtime/operations/assistant/**` for read-only `status` / `doctor` inspection. Session JSON keeps only public provider headers; secret-bearing provider headers live in private sidecars under `vault/.runtime/operations/assistant/secrets/**`, and `assistant doctor --repair` can tighten permissive runtime modes in place. Assistant ask/chat and the root `chat` shorthand are Codex App Server surfaces only: they accept Codex launch/config overrides such as `--codexCommand`, `--codexHome`, `--modelProvider`, `--reasoningEffort`, `--sandbox`, `--approvalPolicy never`, and `--profile`. Assistant-originated writes are rebound to the real host-side user turn instead of trusting client-supplied provenance text, and the canonical vault remains authoritative.

Assistant personality settings remain canonical product state in the active runtime's `bank/preferences.json`, owned by core preference usecases. They are intentionally absent from the raw CLI so no registered general command advertises an audience-independent path to them. Private direct turns and authenticated hosted Linq group turns receive the exact-turn `murph.assistant_style` operation instead; the former targets the person runtime and the latter targets only the synthetic room runtime. Hosted mutations obtain the current provider batch's runtime-owned causal frontier, equal to the newest exact-successor sequence admitted before provider start; the model cannot supply or rewrite that number or a target member. Synthetic room writes also require the accepted input's current non-direct Linq route authority, and group email cannot mutate room style. Per-field watermarks live in the bounded companion `bank/assistant-preference-mutations.json` and are committed by the same owner. This is a registered-tool and prompt-surface policy, not a filesystem sandbox around the privileged Codex runtime. The first personality-aware reader/writer release remains the rollback floor because older strict readers can reject `assistant.personality`.

Assistant delivery targets are transport-native strings only; serialized objects such as JSON blobs or `[object Object]` are rejected before outbound delivery. `assistant status --session <id>` preflights the session id and fails with the assistant session-not-found error instead of silently falling back to a global empty status window.

The existing assistant runtime commands remain runtime inspection/control only. Any future user-facing, queryable, or durable assistant setting must pass the persisted-state placement gate: canonical product state is not an `assistant` runtime CRUD surface, so it must use a core-owned canonical record or explicit derived materialization.

`vault-cli knowledge *` manages Murph's non-canonical personal compiled wiki under `derived/knowledge/**`. That wiki is distinct from the stable reference layer under `bank/library/**`: `bank/library` is durable shared health context, while `derived/knowledge` is the assistant-authored user-specific synthesis layer. `knowledge upsert` writes one page and refreshes `derived/knowledge/index.md`. `knowledge append-section` creates the page when needed or appends/prepends one `## <heading>` section through the same locked write path, rejects duplicate section headings on the target page, refuses to overwrite an existing page file that cannot be loaded as a knowledge graph page, refreshes the index, and appends the write log. Each successful upsert or append also appends a chronological entry to `derived/knowledge/log.md`, and whitespace-only bodies are rejected before any write. `knowledge log tail` is the intentionally small operator-facing log inspection surface; richer wiki-maintainer behavior belongs in the assistant runtime prompt plus the first-class assistant knowledge tools, not in `AGENTS.md`.

The per-command synopses above intentionally omit incur-owned global output and discovery flags such as `--format`, `--json`, `--full-output`, `--schema`, `--llms`, `skills add/list`, and `--mcp`. Leaf-command `--schema --format json` returns that command's args/options/output schema. Root or group `--schema --format json` returns a `murph.schema-index.v1` command index so agents do not receive human help text for a JSON request. For commands that take `--input @file.json|-` or `--input @file.jsonl|-`, the command schema intentionally describes the file option; a matching `payload-schema` command, where present, is the first-class file-body contract and returns the Murph-owned JSON contract as `murph.payload-schema.v1`. Scaffold commands are examples, not complete writable contracts. The current supported payload-schema tranche covers `condition import-json`, `blood-test import-json`, `encounter import-json`, `workout import-json`, `assertion import-json`, `vitals import-json`, `diagnostic-test import-json`, `clinical-note import-json`, `social-history import-json`, and per-line `event import-jsonl` rows. The payload-schema migration plan in `docs/incur-payload-schema-migration-guide.md` defines the rollout for remaining import surfaces. These surfaces are provided by incur and thin Murph CLI adapters and are not re-frozen command-by-command in this contract.

`event import-jsonl` rows must omit caller-supplied `id`, `eventId`, and
`dayKey`; ids and local-day shards are derived by core. `externalRef` is
optional for compatibility with append-only import producers. Include it when a
JSONL row should be retry-safe: for ISO-versioned rows with the same external
identity, older revisions are skipped, an equal revision must match the stored
content apart from the derived `dayKey` and an equivalent
`externalRef.version` lexeme or the batch is rejected, and a newer revision
supersedes in place. Explicit retraction decisions exist only on the decisions
surface, not `event import-jsonl`. Other same-identity rows are skipped when
identical or superseded in place, while rows without `externalRef` intentionally
append a fresh event every time the same file is applied.

Read-only vault metadata and audit commands require an initialized vault root and fail with `invalid_vault` before query reads when `vault.json` is missing. Missing default-vault routing failures use `missing_vault`; typed CLI errors include a boolean `retryable` field in the JSON error envelope.

## Health Noun Grammar

```text
vault-cli <noun> scaffold --vault <path> [--request-id <id>]
vault-cli <noun> import-json --vault <path> --input @file.json [--request-id <id>]
vault-cli <noun> show <id|current> --vault <path> [--request-id <id>]
vault-cli <noun> list --vault <path> [--limit <n>] [--request-id <id>]
```

Supported payload-schema health nouns additionally expose:

```text
vault-cli <noun> payload-schema
```

The placeholder grammar above applies to health nouns that expose the shared scaffold/import-json/show/list command shape. The first payload-schema health tranche is `condition` and `blood-test`; native Incur command definitions and generated discovery metadata are the executable source of truth for the current command graph.

## Noun Composition

- `goal`, `condition`, `allergy`, `family`, `genetics`, `blood-test`, `immunization`, `provider`, `food`, and `event` are payload-CRUD nouns.
- `food` is a payload-CRUD noun backed by `bank/foods/*.md` for recurring meals, grocery staples, smoothies, and remembered restaurant orders, and `food schedule` / `food unschedule` add the thinnest first-class recurring-food layer by pairing a remembered food with a daily note-only meal auto-log rule backed by assistant runtime automation internals or clearing that rule explicitly.
- `recipe` is also a payload-CRUD noun backed by `bank/recipes/*.md`.
- `regimen` is the private medication, supplement, therapy, and habit registry noun; it is primarily payload CRUD and also exposes `stop` as an id-preserving lifecycle helper.
- `protocol` is the private Health Commons-backed adaptation noun; it exposes explicit reviewed JSON import plus readable/list surfaces, while public recipe discovery stays under `commons protocol`.
- `blood-test` is a dedicated user-facing payload-CRUD noun backed by canonical `kind: "test"` records on the shared `ledger/events` seam; it remains a projected event view rather than a separate query/storage family.
- `assertion` is the bounded explicit clinical assertion facade for negative, denied, normality, and no-known-* facts. It writes canonical `kind: "clinical_assertion"` events rather than allergy, condition, or social-history records.
- `vitals` is a visit-import convenience facade over canonical `kind: "measurement"` events.
- `diagnostic-test` is a general test-result import facade over canonical `kind: "test"` events when the specialized `blood-test` noun is too narrow.
- `clinical-note` is a structured-note import facade over canonical `kind: "note"` events.
- `social-history` is an import facade that writes canonical `clinical_assertion`, `exposure`, or tagged `note` events in one validated batch and does not introduce a `social_history` event kind or registry. Every entry carries its own `externalRef`; `status: "current"` and `status: "former"` write exposures for exposure categories, `denied`/`never`/`not_applicable` write assertions, and `unknown` or missing statuses write notes.
- `immunization` is a dedicated user-facing payload-CRUD noun backed by canonical `kind: "immunization"` records on the shared `ledger/events` seam; it remains a projected event view rather than a separate query/storage family.
- `supplement` is a regimen-backed payload-CRUD noun for branded supplement products and also exposes `stop` plus a derived `compound` ledger that rolls overlapping active ingredients into canonical compound rows.
- `document` exposes `import | edit | show | list | manifest`, and `meal` exposes `add | edit | show | list | manifest`.
- `workout` is a quick-capture noun layered on top of canonical `activity_session` events; `workout format` adds only a thin saved-defaults layer under `bank/workout-formats/*.md` and still feeds the same canonical event path rather than introducing a competing workout subsystem.
- `capture` is a dated media-evidence noun layered on canonical event records plus immutable raw capture attachments.
- `measurement` is the primary scalar-measurement noun for numeric body, vitals, performance, and custom metrics.
- `encounter` is a JSON bundle-save noun for imported visit summaries; it writes one canonical encounter plus linked measurement/procedure/test events and does not create a separate encounter storage family.
- `intervention` is a quick-capture noun layered on top of canonical `intervention_session` events; it intentionally does not introduce a separate intervention record family or follow-up read grammar.
- `intake` exposes `import | show | list | manifest | project`.
- `samples` exposes `add | import-json | import-csv | csv profile | csv import | summarize | show | list | batch show | batch list`.
- `experiment` is a lifecycle noun.
- `journal` is a date-addressed document noun.
- `vault` exposes `show | stats | repair | update`.
- `export` exposes `create | show | list | materialize | prune`.
- `audit` exposes `show | list | tail`.
- `assistant` is a Codex App Server-backed orchestration noun for local chat turns, outbound delivery, session inspection, runtime diagnostics, and always-on inbox triage; it stores only runtime metadata under `vault/.runtime/operations/assistant/**`, uses explicit conversation bindings for session reuse, coalesces adjacent pending inbound messages from the same conversation lane into one auto-reply turn before advancing the reply cursor, can opt into self-authored auto-reply plus age-based session rollover for dedicated self-chat threads, treats `--deliveryTarget` as a one-send override, only fires due canonical automations while `assistant run` is active for the vault, and delegates canonical promotions back through inbox/core boundaries.
- `memory` is a canonical product noun backed by the single curated `bank/memory.md` document; operators inspect the whole document with `show`, save the user's preferred display name with the typed `set-name` command, and mutate individual records with `upsert`, `update`, or `forget`. `memoryId` arguments use `mem_<ULID>` ids. Group runtimes receive the preferred display name through the consented `profile-name.v0` vault-share projection from memory.
- `automation` is a canonical product noun backed by `bank/automations/*.md` and exposes typed `save`, explicit `import-json`, readable/list, and scaffold surfaces.
- Top-level `chat` is a shorthand alias for `assistant chat`; it shares the same prompt/options/output contract so installed `murph chat` discovery stays truthful.
- Top-level `status` is a shorthand alias for `assistant status`; it shares the same option/output contract so installed `murph status` discovery stays truthful.
- Top-level `doctor` is a shorthand alias for `assistant doctor`; it shares the same option/output contract so installed `murph doctor` discovery stays truthful.
- Top-level `run` is a shorthand alias for `assistant run`; it shares the same option/output contract so installed `murph run` discovery stays truthful while keeping automation explicit.
- Top-level `stop` is a shorthand alias for `assistant stop`; it shares the same option/output contract so installed `murph stop` discovery stays truthful while giving operators a supported recovery path for stuck assistant automation locks.
- `device` is backed locally by `@murphai/device-syncd`; it exposes provider discovery plus browser-based connect/reconcile/disconnect actions, and it can also start, inspect, or stop the Murph-managed local daemon for the selected vault. In hosted execution, `device account list` and `device account reconcile` use the invocation-scoped bridge instead of starting a local daemon.

These are semantic groupings, not a parallel command registry. For example, `event` remains the generic write/read surface for non-specialized event kinds, and `provider` remains the registry-backed noun for `bank/providers/*.md`.

Registry-backed readable/list surfaces may expose noun-specific filters where the underlying records justify them. `goal`, `condition`, `allergy`, `regimen`, `protocol`, and similar registry nouns may expose `--status <status>`. `blood-test list` exposes `--status`, `--from`, `--to`, and `--text`; `immunization list` exposes `--from` and `--to`. Generic top-level `list` adds `--record-type`, `--status`, `--stream`, and `--tag` parity, while `event list --kind <kind>` remains the generic event-ledger filter surface.

## Native Incur Contract

Every command now uses native `incur` command definitions directly:

1. `incur` validates positional arguments and named options against the command schema.
2. The handler receives parsed `args` and `options` and delegates to the owning boundary surface for that noun. Current owners include `core`, `importers`, `query`, `vault-usecases`, `inbox-services`, `device-syncd`, `assistant-cli`/`assistant-engine`, and gateway packages. Canonical health writes still terminate in `packages/core`.
3. The handler returns the command-specific payload directly.
4. Plain `--format json` writes that payload body directly to stdout.
5. `--full-output --format json` wraps the same payload in incur's success/error envelope, including metadata and CTAs when present.
6. Human-oriented rendering, alternate formats, completions, `--llms`, skills, and MCP surfaces are incur-owned and are not redefined here.

Read surfaces intentionally separate summary from detail:

- `show` returns the full canonical read entity, including `markdown` when that noun owns body text.
- `list` returns summary rows, not many embedded `show` payloads.
- A text-filtered `blood-test list` row may add one bounded
  `data.matchedResult` containing only the matched analyte's answer-bearing
  scalars (`analyte`, numeric or text value, unit, comparator, flag, and compact
  reference range). It does not embed the full panel or unrelated results;
  unfiltered panel lists retain ordinary compact behavior.
- List rows never include full `markdown`; when a family owns first-class body text, list rows may carry a compact `excerpt` instead.
- Default read/status/list/tail pages are model-facing summaries and should fit under roughly 15k characters with `--full-output --format json` on representative oversized fixtures.
- Assistant timelines, raw provenance, import manifests, full nested telemetry arrays, and long instruction/body text require an explicit detail/export/schema path or an explicitly raised `--limit`; `--full-output` is an envelope selector, not an uncompression switch.
- Callers that need the full body must follow a list result with `show`.

## Shared Option Rules

- `--vault <path>` is required for canonical vault commands so the target vault is explicit. `device` commands also require it so Murph can manage the local daemon and its launcher state for that vault, even when callers override the control-plane endpoint with `--baseUrl`.
- `--baseUrl <url>` overrides the reachable local control-plane endpoint for `device` commands. If omitted, the CLI uses `DEVICE_SYNC_BASE_URL` and then the Murph-managed local daemon default.
- `--request-id` is optional where exposed, forwarded to package service calls, and reserved for audit correlation.
- Incur's global output flags are available everywhere; this contract freezes only the command-specific option semantics and JSON payload shapes described below.
- Machine-stable callers that need metadata or CTA suggestions should prefer `--full-output --format json`. The payload examples below describe the `data` body emitted by plain JSON mode.
- Retrieval filters and similar multi-value options use repeatable flags such as `--kind meal --kind note`, `--entry-type event --entry-type sample_summary`, or `--metadata-columns device --metadata-columns context`. Comma-delimited tokens such as `--kind meal,note` are invalid and should be rewritten as repeated flags. `sample_summary` refers to display-grade metric/sample summaries, not raw generic `ledger/samples` telemetry.
- Canonical ids emitted by core/import flows follow the frozen `<prefix>_<ULID>` policy in `docs/contracts/02-record-schemas.md`.
- Commands that create or read canonical records align to the generated schemas in `packages/contracts/generated/`.
- Write/import commands return `lookupId` or `lookupIds` when the follow-on read path should use the canonical read id rather than a batch id or internal provenance id.
- `import-json --input @file.json` uses one file argument and does not expose per-field mutation flags in the public grammar.

## Lookup Rules

- `show` accepts canonical read ids such as `core`, `journal:<YYYY-MM-DD>`, `exp_*`, `evt_*`, `smp_*`, `aud_*`, `asmt_*`, `goal_*`, `cond_*`, `alg_*`, `prot_*`, `fam_*`, `var_*`, `doc_*`, and `meal_*`.
- `provider show` accepts either the canonical `prov_*` id or the stable provider slug stored in `bank/providers/<slug>.md`.
- `food show` accepts either the canonical `food_*` id or the stable food slug stored in `bank/foods/<slug>.md`.
- `recipe show` accepts either the canonical `rcp_*` id or the stable recipe slug stored in `bank/recipes/<slug>.md`.
- `event show` accepts the canonical `evt_*` id. Specialized nouns such as `document`, `meal`, `blood-test`, `immunization`, and `experiment` remain the preferred follow-up surface when they already exist. `workout add`, `workout format log`, and `intervention add` intentionally return the event id and rely on `event show|list` plus generic `show|list` for follow-on reads.
- `blood-test show` accepts the canonical `evt_*` id and may also resolve the stored blood test by its title, `testName`, or `labPanelId`.
- `immunization show` accepts the canonical `evt_*` id and may also resolve the stored immunization by title, `vaccineName`, or `lotNumber`.
- Generic `show` accepts canonical read ids for event-backed records, including the stable `doc_*` and `meal_*` family ids. `event show` remains the explicit provenance-oriented follow-up surface when the caller needs the internal event id path, while `document manifest` and `meal manifest` expose immutable import artifacts.
- `samples batch show` and `samples batch list` are the first-class follow-up surface for `xfm_*` import-batch ids; generic `show` still does not accept them.
- `intake manifest` is the first-class follow-up surface for immutable assessment import evidence under `raw/assessments/**`.
- `audit show|list|tail` and `vault show|stats|repair|update` are first-class vault noun commands layered on top of the read model and core metadata write path.
- Export pack ids identify derived files under `exports/packs/`; they are not valid `show` targets.
- `sample-summary:<date>:<stream>` ids emitted by `timeline` are derived context handles, not valid `show` targets.
- A successful `show` response surfaces the canonical read id in `entity.id`.
- `device account show|reconcile|disconnect` accept the device-sync control-plane account ids returned by `device account list`; they are not canonical vault ids.
- Hosted `device account reconcile` appends one member-bound device-sync wake. The runtime delegates provider-specific job creation to the existing device-sync service; hosted `show` and `disconnect` remain unavailable, and browser Settings remains the hosted disconnect owner.

## Success Output

For plain `--format json`, successful commands write the command payload directly:

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
- With `--full-output --format json`, the same payload appears under `data` in incur's success envelope.
- Exit code `0` indicates success.
- The payload examples below are representative rather than exhaustive. Newer noun and mutation commands follow the same direct-payload rule and are covered by the runtime schemas in `packages/cli/src/**/*.ts`.

## Failure Output

For plain `--format json`, failed commands write a direct error object and exit non-zero:

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
- With `--full-output --format json`, the same error shape appears under `error` in incur's envelope.

## Command Payloads

The examples below are the full successful plain `--format json` response bodies.

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

The freeform note is preserved verbatim in `note`. Top-level `activityType`, optional `durationMinutes`, and optional `distanceKm` stay as summary fields, while all rich workout detail lives under the canonical nested `workout` payload.
For freeform capture, Murph only infers `durationMinutes` when the note states one clear total workout duration. Mixed-activity notes, segmented notes, or notes without a clear total duration must pass `--duration`.

For structured agent writes, `workout payload-schema --format json` emits the import file-body contract used by `workout import-json --input @file.json|-`. Its `strengthExercises` form is the compact path for repeated strength sets such as `setCount` plus `repsPerSet`; ambiguous load text belongs in `loadDescription` so the note is preserved without inventing a numeric weight.

### `workout import inspect` and `workout import csv`

`workout import inspect` is the non-mutating planner for Strong and Hevy-style workout exports. It parses timestamps in the vault timezone, reports aggregate row repair and omission counts, estimates the workout count, and returns explicit weight or distance unit requirements without writing raw evidence or canonical events. Its public result never includes source header cells or row content; malformed and near-limit files therefore keep assistant-facing output fixed and bounded. Unitless positive values make the plan non-importable until the caller supplies the matching unit option; Murph must not infer those units from locale or value magnitude.

`workout import csv` validates the complete structured batch before writing. A malformed mapped workout rejects the whole structured import without storing its raw batch. A valid import stores one immutable raw CSV and manifest, then commits all canonical `activity_session` decisions through one batch operation. The CSV owner alone may omit an invalid, over-range, or absent source duration with an aggregate warning while preserving otherwise valid exercises and sets; generic event JSONL import, ordinary add, workout import-json, and saved-format logging still require or derive a duration before writing. Replaying the same source sessions returns skipped-existing counts and does not store another raw copy. Response identifier and ledger-path lists are capped at ten entries with explicit truncation flags, so large history imports do not expand assistant context in proportion to the workout count.

The confirmed `--weight-unit` applies to every positive unitless load field, including bodyweight, assistance, and added weight. Unit-bearing values and headers remain authoritative; conflicts block the batch. Auxiliary loads are converted to canonical kilograms before persistence. If a member previously confirmed the wrong unit, rerun the exact original CSV with the corrected unit and `--correct-units`; this route requires exact prior raw evidence, reparses with the original evidence timezone, starts from each latest attached canonical event, and patches only unit-derived load or distance fields plus the source revision. Tags, activity classification, links, experiment context, evidence, attachments, data origin, workout media, route/metrics, routine context, timestamps, notes, reps, set duration, RPE, and other non-unit fields therefore survive by construction. Only an exercise/set insertion, deletion, or reorder that makes positional unit ownership ambiguous blocks the correction structure check; an edit to the selected load or distance axis must still match a valid interpretation of the exact raw file. Correction stores no duplicate raw batch and cannot be combined with `--store-raw-only`. If the original timezone or provider cannot be proved, correction fails before mutation.

Workout CSVs do not carry a source revision. Murph assigns a dated importer-mapping revision to the canonical result: an unchanged replay is a no-op, while changed content for the same source session fails closed instead of guessing which version is newer. The planner exposes a provider-neutral, privacy-safe session key derived from a canonical representation of the source wall-clock or offset timestamp; equivalent accepted spellings such as omitted zero seconds share one key without depending on the vault timezone, while a real source-time change does not. The public identity remains provider-scoped. When the provider supplies an end timestamp, a separate privacy-safe raw-input key makes an end-time change observable without coupling replay checks to a later canonical timestamp edit. For a refreshed snapshot, the usecase boundedly verifies up to 100 prior workout batches and 50 MiB of raw artifacts, replans them with recorded provenance, and resolves each original raw attachment together with its latest event revision through one core lookup. Every source session in an admitted prior snapshot must remain present; a missing or changed prior session fails the complete batch before persistence. The attachment identifies the source session; the latest revision supplies current member-edited content and lifecycle state. Overlapping live sessions preserve that current payload, deleted sessions stay deleted, and only genuinely new additional sessions receive new identities and attach to the new raw snapshot. A legacy manifest without unit provenance can join a confirmed expanded snapshot only when its latest canonical projection already proves that interpretation; otherwise the exact original file must be unit-corrected first. Conflicting, partial, over-limit, changed, or ambiguous overlap fails before a new raw snapshot is stored. A concurrent edit may still make the canonical apply fail after raw evidence is stored; retry reconciliation safely reuses that immutable evidence.

Exact-file unit or provider corrections use a newer mapping revision. A provider correction compares the prior and requested dialects, patches only dialect-owned source, note, set-order, and set-type fields onto the current event, and preserves all other canonical context. It reparses that dialect with the exact manifest's original units, so a member correcting both provider and units runs the confirmed `--source` first without restating a known-wrong unit, then runs a separate `--correct-units` command with the corrected unit. Each mutation remains narrow and independently reviewable. Exact raw matching remains provider-label independent, so a prior ambiguous file mislabeled Strong can adopt Hevy semantics in place and later expanded Hevy snapshots still reuse its original event identity.

Current Strong exports may include `W`, `D`, and `F` set tags, rest-timer metadata rows, unitless weight and distance values, timezone-less timestamps, and text fields with an unquoted comma. The importer preserves the three set tags, omits rest-timer metadata with an aggregate warning, uses the vault timezone, backfills the first non-empty session/exercise metadata across later rows, and repairs only a uniquely supported current-header row shape. Unit-bearing `Distance Km`, `Distance Meters`, and embedded-unit values preserve each set distance; the canonical session distance is the sum of accepted positive set distances. Plain positive distance still requires `--distance-unit`. Rows that cannot be mapped without guessing block the structured write. A missing, malformed, or out-of-range duration is omitted with a warning while its otherwise valid sets remain importable.

An explicit recognized `--source strong|hevy` selects that parser dialect. Without it, only the exact recognized Strong signature or Hevy-specific markers select a provider. Headers shared by both formats leave inspection non-importable with an instruction to choose Strong or Hevy; they are never guessed as Strong. If an explicit source conflicts with unambiguous provider-specific headers, inspection and import fail before raw or canonical persistence. `--store-raw-only` relaxes row and unit importability, but it uses the same provider-recognition gate and does not persist an ambiguous export under a guessed label. A later structured import reuses an unattached raw-only batch only when its provider, delimiter, timezone, weight unit, and distance unit exactly match the final plan; confirmed provenance otherwise gets a new immutable batch, and canonical events attach only to that batch.

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
  "regimenId": "reg_123",
  "experimentId": "exp_123",
  "experimentSlug": "sauna-rhr",
  "experimentLinkMode": "auto",
  "note": "20 min sauna after lifting."
}
```

The freeform note is preserved verbatim in `note`. The structured fields stay intentionally small: one canonical `intervention_session` event plus one inferred or explicit `interventionType`, optional `durationMinutes`, an optional `regimenId` link back to one therapy or habit regimen, and optional experiment relation fields.

Experiment linking is conservative. If exactly one active experiment matches the intervention type and the session date falls inside that experiment's intervention window, `intervention add` links it automatically and returns `experimentLinkMode: "auto"`. If multiple active experiments match, the command fails before writing; pass `--experiment <slug-or-id>` to choose one or `--skip-experiment-link` to save the session unlinked. `--allow-out-of-window` is only valid with an explicit `--experiment`.

### `samples csv profile`

`samples csv profile` is the non-mutating companion to CSV import. It returns the planner's view of the file: detected columns, row counts, blank rows, inferred timestamp column, vault timezone assumption, candidate streams, skipped-row reasons, source-shape hints, and optional pre-write summaries. It must not write canonical samples, raw sample manifests, or audit ledger entries.

When `--include-summary` is supplied, the command summarizes the planned numeric samples before write. `--summary-profile oxygen-night` adds the generic SpO2 thresholds `92`, `90`, and `88`, run/cluster detection, gap detection, and a cautious oxygen-trace screen. The screen is a data summary only; it must not diagnose or rule out sleep apnea.

```json
{
  "vault": "<path>",
  "sourceFile": "<path>",
  "file": {
    "kind": "csv",
    "fileName": "export.csv",
    "byteSize": 990000,
    "delimiter": ",",
    "rowCount": 30010,
    "dataRowCount": 30009,
    "blankRowCount": 0
  },
  "time": {
    "timeZone": "America/New_York",
    "timestampColumn": "Time",
    "firstRecordedAt": "2026-04-17T04:55:47.000Z",
    "lastRecordedAt": "2026-04-17T13:16:00.000Z",
    "sampleIntervalSeconds": 1,
    "gapCount": 0,
    "gaps": []
  },
  "series": [
    {
      "stream": "spo2",
      "unit": "%",
      "valueColumn": "Oxygen Level",
      "importableCount": 30009,
      "skippedCount": 0,
      "skipReasons": [],
      "minValue": 88,
      "maxValue": 99,
      "averageValue": 96.6,
      "confidence": 0.98
    }
  ],
  "sourceHints": [
    {
      "id": "wellue-o2ring-csv",
      "label": "O2Ring-style CSV",
      "confidence": 0.86
    }
  ],
  "warnings": []
}
```

Source hints are advisory only. They may describe familiar export shapes, but durable rows remain explicit raw/debug sample-ledger records; this command must not introduce device-specific sample records or a device-specific importer family.

### `samples summarize`

`samples summarize` reads the explicit raw/debug sample ledger for one stream and one timestamp window, then runs the same generic summary engine used by pre-write CSV profiling. It does not use the default `readVault()` read model.

```json
{
  "vault": "<path>",
  "summary": {
    "stream": "spo2",
    "unit": "%",
    "from": "2026-04-17T04:55:47.000Z",
    "to": "2026-04-17T13:16:00.000Z",
    "sampleCount": 30009,
    "numericSampleCount": 30009,
    "firstSampleAt": "2026-04-17T04:55:47.000Z",
    "lastSampleAt": "2026-04-17T13:16:00.000Z",
    "durationSeconds": 30013,
    "sampleIntervalSeconds": 1,
    "minValue": 88,
    "maxValue": 99,
    "averageValue": 96.6,
    "thresholds": [
      {
        "below": 90,
        "sampleCount": 4,
        "durationSeconds": 4,
        "runCount": 1,
        "clusterCount": 1,
        "longestRunSeconds": 4
      }
    ],
    "gaps": [],
    "warnings": []
  }
}
```

For `--profile oxygen-night`, the summary defaults to SpO2 threshold burden below `92`, `90`, and `88`, reports longest runs and cluster counts, and may include a conservative `screen` field. The screen is intended for assistant grounding, not clinical diagnosis.

### `samples import-csv`

```json
{
  "vault": "<path>",
  "sourceFile": "<path>",
  "timeZone": "America/New_York",
  "tsColumn": "Time",
  "importedCount": 84,
  "skippedCount": 3,
  "lookupIds": ["smp_123", "smp_124"],
  "ledgerFiles": ["<path>"],
  "streams": ["spo2", "heart_rate"],
  "imports": [
    {
      "stream": "spo2",
      "unit": "%",
      "timeZone": "America/New_York",
      "tsColumn": "Time",
      "valueColumn": "Oxygen Level",
      "importedCount": 42,
      "skippedCount": 1,
      "skipReasons": [{ "reason": "non-numeric value", "count": 1 }],
      "transformId": "xfm_123",
      "manifestFile": "<path>",
      "lookupIds": ["smp_123", "smp_124"],
      "ledgerFiles": ["<path>"]
    }
  ],
  "inferred": {
    "timeZone": "America/New_York",
    "tsColumn": "Time",
    "metadataColumns": ["Motion"],
    "imports": [{ "stream": "spo2", "valueColumn": "Oxygen Level" }]
  }
}
```

Each entry in `imports` represents one stream-specific batch attempt. When a stream had no importable rows after best-effort parsing, that entry still reports `skippedCount` and `skipReasons`, but its `transformId`, `manifestFile`, `lookupIds`, and `ledgerFiles` stay empty or `null` because no canonical batch was written. `samples csv import` is the preferred composable spelling for the same import path; `samples import-csv` remains as a compatibility wrapper.

`samples import-csv` should make a best-effort pass over real-world device exports: it may infer one shared timestamp column, import every recognizable metric column in the same file, normalize common naive timestamps using the vault timezone, parse obvious numeric suffixes such as `%`, `bpm`, and digit group separators, and skip malformed rows in provenance instead of failing the entire batch. It should fail only for true ambiguity, such as multiple plausible timestamp columns or multiple columns mapping to the same canonical stream.

### `experiment start`

```json
{
  "vault": "<path>",
  "dryRun": false,
  "plan": {
    "planId": null,
    "materialAdaptation": false,
    "needsPrivateProtocol": false,
    "reasons": [],
    "operations": ["experiment_create", "experiment_update"]
  },
  "protocol": null,
  "experiment": {
    "experimentId": "exp_123",
    "lookupId": "exp_123",
    "slug": "sleep-window",
    "experimentPath": "<path>",
    "status": "active",
    "created": false,
    "updated": true
  }
}
```

The `plan.operations` values are internal core plan operation names, not public CLI command names.

`dryRun: true` validates the same typed start fields without writing vault records and returns `experiment: null`.

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
- `document manifest`, `meal manifest`, `samples batch show`, `intake manifest`, and `export pack show` return direct artifact-inspection payloads rather than generic `entity` wrappers.
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

The query text may be passed either positionally as `vault-cli search query <query>` or explicitly as `vault-cli search query --text <query>`.

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

`dbPath` always reports the shared query-owned local projection at `.runtime/projections/query.sqlite`. Inbox runtime databases are separate stores and are never treated as fallbacks for query reads or lexical search; retired `gateway.sqlite` residue is ignored as machine-local projection state.

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
    "limit": 50
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
      "path": "ledger/metric-samples/heart_rate/2026/2026-03.jsonl",
      "relatedIds": ["smp_123", "smp_124"],
      "tags": ["sample_summary", "heart_rate"]
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
The five-file pack shape stays stable; health extensions enrich `manifest.json`, `question-pack.json`, and `assistant-context.md` with assessments, memory/wiki/preferences context, health-event context, and registry context while keeping `records.json` as the main exported records array.

`vault-cli samples list/show/summarize` is the explicit raw sample-ledger inspection surface. Those commands read `ledger/samples/**` directly with filters and limits; default `readVault()`, search, assistant setup, and browser-vault refresh do not hydrate generic sample rows.

## Boundary Rules

- `init`, `validate`, `meal add`, `document import`, `samples import-csv`, and `intake import` delegate to `packages/core` or `packages/importers` write paths that preserve immutable raw evidence and append-only ledgers.
- `provider save|import-json`, `food save|import-json|schedule|unschedule`, `recipe save|import-json`, `automation save|import-json`, typed `event * add`, `event import-json`, `samples add`, `samples import-json`, `supplement save|stop`, `medication history add`, `regimen save`, `regimen import-json`, `regimen stop`, `protocol import-json`, `workout add`, `workout format save|show|list|log`, `intervention add`, `experiment start|edit|checkpoint|stop`, `experiment session log`, `experiment context log`, `journal ensure|append|link|unlink`, `vault repair|repair-experiment-media|repair-junction-hr-zones|update`, `intake project`, health `<noun> scaffold`, and health `<noun> import-json` delegate to `packages/core` exports or to CLI-local helpers built only on top of `packages/core` frontmatter/jsonl primitives, importer entrypoints, canonical write locks, and assistant runtime automation state. The two inbox storage-maintenance commands delegate through `packages/inbox-services` to their `inboxd` and parser owners.
- `show`, `list`, `search query`, `query projection status|rebuild`, `timeline`, `document/meal/samples/intake/export` follow-up reads, `audit show|list|tail`, and `vault show|stats` delegate to the read model plus immutable-manifest inspection helpers.
- Inbox ingestion, projection, audio/video transcription, and promotion helpers are owned by `packages/inboxd`, `packages/parsers`, and shared `packages/core` primitives. They are programmatic runtime services, not a `vault-cli inbox` command namespace.
- Contract validation errors normalize to the shared codes in `docs/contracts/04-error-codes.md`.
- The default CLI service layer is expected to delegate to the real `core`, `importers`, and `query` package exports. If the local TypeScript or `incur` toolchain is unavailable, that is an environment blocker, not a contract excuse to return placeholder payloads.
