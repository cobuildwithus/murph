---
name: murph
description: Use Murph's existing vault CLI as the canonical way to read and update a Murph vault from OpenClaw.
user-invocable: false
homepage: https://github.com/cobuildwithus/murph/tree/main/packages/openclaw-plugin
metadata: {"openclaw":{"requires":{"bins":["vault-cli"]}}}
---

Use Murph's existing `vault-cli` surface. Treat the vault as the source of truth. Do not create or manage a second Murph assistant runtime inside OpenClaw.

Use OpenClaw's built-in `exec` tool to run `vault-cli` commands.

Rules:
- Prefer `vault-cli` over raw file edits.
- Do not edit canonical vault Markdown, JSON, or JSONL files directly unless the user explicitly asks for raw file edits.
- Prefer read and query commands first. Only perform writes the user asked for.
- Avoid interactive Murph entrypoints such as `murph chat`, `murph run`, `vault-cli chat`, `vault-cli run`, `assistant chat`, and `assistant run`.
- Prefer the operator's configured default vault. Do not pass `--vault` unless the user explicitly wants a different vault or the command fails because no default vault is configured.
- When structured output will help, append `--format json`.
- Do not quote raw vault root, runtime root, status path, or other local filesystem paths in the user-facing answer. Summarize the relevant fields, or use `--filter-output <field>` when you only need one value.

Discovery order:
1. If you know the exact command, run it directly.
2. If the command path is unclear, run `vault-cli <command path> --help`.
3. If you need exact arguments, option names, or output contracts for one leaf command, run `vault-cli <command path> --schema --format json`.
4. Use `vault-cli --llms` or `vault-cli --llms-full` only for broad discovery.

Schema notes:
- `vault-cli --schema --format json` and group requests such as `vault-cli device --schema --format json` return a `murph.schema-index.v1` command index, not one leaf payload schema.
- For commands that use `--input @file.json|-`, run the matching `scaffold` command to get a payload template before writing.
- JSON error envelopes include `error.code` and `error.retryable`; use the code for recovery decisions. Common setup codes include `missing_vault`, `invalid_vault`, `memory_not_found`, and `knowledge_body_required`.

Read-command chooser:
- `vault-cli show <id>` for one exact record id.
- `vault-cli list ...` for structured filters.
- `vault-cli search query "<query>"` for fuzzy recall. `--text "<query>"` remains valid for explicit callers.
- `vault-cli timeline ...` for chronological questions.
- `vault-cli memory show` plus `vault-cli knowledge ...` reads for saved user context.
- For common wearable questions, prefer the normalized first reads first: `vault-cli wearables latest`, `vault-cli wearables metric latest <metric>`, `vault-cli wearables metric trend <metric>`, and `vault-cli wearables drift`. Use `vault-cli wearables day ...` or other `wearables ... list` commands when the question is date-specific or you need one summary family in more detail.
- family `manifest` commands such as `capture manifest`, `meal manifest`, `document manifest`, `intake manifest`, and `workout manifest` for immutable import provenance.

If Murph is not configured yet:
- ask the operator to install `@murphai/murph` if `vault-cli` is missing
- ask them to run `murph onboard` or set `VAULT=/path/to/vault` if no default vault is configured
- if a command returns `invalid_vault`, ask them to initialize or select an existing Murph vault before retrying

When you answer, summarize the relevant Murph output instead of dumping large raw JSON unless the user asked for the raw result.

## Experiment onboarding

When a user asks to start, run, explore, or set up a protocol, keep the flow as planning until the setup is resolved and the user has agreed to the run. Pause for ambiguity, contradictions, or safety changes; do not create an active experiment or scheduled automation from the first message alone.

Read public Health Commons protocols first with `vault-cli commons protocol show <protocol key or slug> --format json`. If the user names a family or a fuzzy protocol idea, use `vault-cli commons protocol explore "<query>" --format json` or `vault-cli commons protocol list --format json` to resolve the canonical protocol page before planning. Use top-level `vault-cli protocol ...` only for saved private protocol adaptations in the selected vault.

If the protocol comes from Health Commons and has an `experimentOnboarding` block, use that block as the source for the start prompt, vault checks, safety screen, setup slots, plan defaults, logging fields, assistant support policy, and protocol-specific read hints. If the page does not have an onboarding block, fall back to the protocol `safety`, `testPlans`, `protocol`, and `claims` fields for a lightweight onboarding flow.

For source-attributed external protocols, keep the source routine separate from the user's run plan. Do not present a celebrity or external source protocol as Murph's default recommendation; offer a lower-burden variant or defer when the onboarding slots or safety context suggest poor fit.

Useful commands:

- `vault-cli commons protocol show <protocol key or slug> --format json` so you can read `protocol`, `safety`, `testPlans`, `experimentOnboarding`, and `revision.{pageRevisionId,runSpecRevisionId}` before asking setup questions.
- `vault-cli commons protocol list --format json` when the user names a category or approximate protocol rather than one exact page.
- `vault-cli experiment list --status active --format json` before starting, so Murph can preserve the one-meaningful-experiment default.
- `vault-cli memory show --format json` for current saved context.
- `vault-cli search query "<protocol-relevant context>" --format json` for conditions, medications, prior symptoms, injuries, recent workouts, or previous experiment notes.
- `vault-cli timeline ... --format json` for chronological context when timing matters.
- `vault-cli wearables latest --format json`, `vault-cli wearables metric latest <metric> --format json`, `vault-cli wearables metric trend <metric> --format json`, `vault-cli wearables drift --format json`, `vault-cli wearables sources list --format json`, and `vault-cli wearables day <YYYY-MM-DD> --format json` when wearable measurement or baseline quality matters.
- `vault-cli experiment session log <id> ...` with typed flags when the user reports one intervention session for an active experiment and that evidence should become a canonical experiment-linked record.
- `vault-cli experiment context log <id> ...` with typed flags when the user reports confounders, symptoms, illness, travel, medication changes, or other run context that should stay linked to the active experiment.
- `vault-cli experiment followup due <id> --kind missed-log|weekly-digest --format json` before scheduled missed-log or weekly-digest checks; skip when it returns `skip`.
- `vault-cli experiment progress <id> --format json` for current adherence, setup readiness, analysis readiness, wearable coverage, and review context after due logic says a check is actionable.
- `vault-cli experiment outcome analyze <id> --format json` when the user wants a run review, end-of-run interpretation, or a worth-repeating judgment.
- `vault-cli experiment outcome write <id> --format json` when the deterministic outcome is ready, the user wants it persisted, and the experiment record should link to the saved outcome artifact.
- `vault-cli experiment start <slug> --from-protocol <key-or-route> --intervention-start <YYYY-MM-DD> ...` only after protocol-linked setup is resolved enough to persist a run. Use `--custom` only when no same-family Health Commons protocol exists or the user explicitly wants an unlinked experiment.
- `vault-cli experiment start <slug> ... --dry-run --format json` to validate typed start fields before writing.
- `vault-cli experiment edit <id> ...` when an existing run needs scalar fixes, richer `commonsProtocolRef`, `runPlan`, `onboarding`, or `assistantSupport` fields.
- Prefer `vault-cli automation save` with typed schedule, instruction, and route flags after the user opts into reminders or check-ins. Use `automation import-json --input -` only for advanced payloads the typed surface cannot express.

Flow:

1. Check for active experiments.
2. Ask what the user wants to get out of the experiment unless their goal is already clear.
3. Review the protocol page and relevant vault or wearable context before asking repeated setup questions. If the onboarding block includes `contextReview.vaultChecks[].readHints`, treat those as the first read plan. If a hint looks abbreviated or stale, verify the exact command with `vault-cli <command path> --help` or `vault-cli <command path> --schema --format json` before running it.
4. Ask the protocol safety screen even when the vault is silent, especially for high-caution protocols.
5. Ask only setup slots that affect safety, logistics, measurement fidelity, or assistant support. Ask at most two questions per response, keep each turn compact, and continue across later replies until the goal, safety, logistics, measurement, logging, stop-condition, and reminder pieces are covered.
6. If the user reports active-experiment evidence, convert it into canonical experiment-linked records instead of leaving it only in chat prose. If one missing detail blocks a faithful record, ask one compact clarifying question, then log it.
7. If a high-caution screen is positive or uncertain, do not start the protocol unsupervised. Suggest clinician guidance, a lower-intensity alternative, or postponing.
8. Before writing, summarize the plan in user-facing language: protocol name/source, baseline/intervention dates, schedule, modality or dose, logging fields, stop conditions, and reminder policy. Do not read raw revision hashes, field names, or test-plan ids aloud unless the user specifically asks for technical provenance.
9. Persist runs with typed `vault-cli experiment start` flags, then use typed `vault-cli experiment edit <id> ...` for later repairs instead of copying protocol prose into ad hoc fields.
10. Before any scheduled missed-log or weekly-digest decision, read `vault-cli experiment followup due <id> --kind missed-log|weekly-digest --format json` first. Skip when it returns `skip`; use `experiment progress` afterward only for message context when due logic says the check is actionable.
11. Use `vault-cli experiment outcome analyze <id> --format json` for run reviews, and summarize the result with early-signal, associated-with, and confounded-by language rather than causal certainty. If the user wants the result saved back into the vault, follow with `vault-cli experiment outcome write <id> --format json`.
12. Use neutral language for reminders and missed-log checks. A missed-log check should ask whether the session happened, not imply failure.
