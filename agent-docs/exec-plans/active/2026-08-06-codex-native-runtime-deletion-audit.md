# Codex-native runtime deletion audit

Status: active
Created: 2026-08-06
Baseline: `main` at `14182cf46b141b9219b58666849167ad3098a3cc`
Pinned Codex CLI: `0.145.0`

## Goal

Reduce Murph's assistant runtime to the smallest durable product boundary around
Codex App Server.

The target is not to remove code merely because Codex has a similarly named
feature. A deletion qualifies only when Codex already owns the same execution
semantics and Murph can stop owning a state machine, compatibility policy, or
catalog without weakening accepted-work durability, authorization, privacy,
canonical writes, usage accounting, or delivery.

Each implementation pull request from this audit must be net-negative in
hand-authored source, concepts, branches, and owners. Do not replace deleted
code with another wrapper, generated-source maintenance workflow, compatibility
layer, process, cache, or service.

## Decision summary

The audit found four medium-to-high-value deletion candidates:

1. **Hard-cut the App Server protocol adapter to the exact pinned Codex
   protocol.** This is the highest-confidence first change. Murph currently
   accepts a family of invented event envelopes, separators, casings, and field
   aliases even though production pins one Codex version.
2. **Collapse the generic assistant-provider abstraction to a Codex-specific
   internal runtime.** Murph has one execution provider, yet still carries
   registry/factory/config vocabulary designed for hypothetical alternatives.
3. **Use native `model/list` as the model and reasoning catalog owner.** Murph
   currently reconstructs a partial catalog and hardcodes reasoning choices
   that Codex already returns.
4. **Make native Codex skills discovery/loading the single catalog owner.**
   Murph already ships real skill files, but also maintains a separate static
   skill manifest and prompt-level path routing. This needs one proof phase
   before deletion because Murph's trigger hints may contain product policy not
   represented in the skill files today.

A fifth, smaller candidate is the mutable lifecycle registration seam around the
resident App Server. It should be removed only if package ownership can be made
direct without introducing a cycle or moving lifecycle state to another owner.

## Audit baseline

Murph already completed the important architectural hard cut:

- the hosted harness is `codex app-server`;
- one resident App Server belongs to `packages/assistant-engine`;
- native Codex threads, turns, steering, compaction, tools, and MultiAgent V2
  are used;
- Murph owns the product boundary around accepted work, route and actor
  authority, canonical vault writes, checkpoints, usage, outbox intent, and
  delivery.

This audit therefore focuses on residue around that boundary rather than
replacing the current architecture.

The production image pins `@openai/codex@0.145.0`. Codex 0.145 can emit
version-matched TypeScript or JSON schemas through
`codex app-server generate-ts` and `generate-json-schema`. Its canonical
stdio transport, lifecycle methods, notifications, `model/list`, dynamic tools,
skills, compaction, memory, thread inspection, and MultiAgent behavior are
specified by that exact version.

## Ownership boundary

| Capability | Owner after this audit | Reason |
| --- | --- | --- |
| App Server process, thread, turn, item, streaming, built-in shell/file/web execution, native compaction, native subagents | Codex | These are execution-substrate semantics. Murph should consume them, not supervise or reinterpret them. |
| JSON-RPC transport client over stdio | Murph, thinly | Codex does not ship a supported TypeScript App Server client. The official TypeScript SDK wraps `codex exec`, which would lose warm threads, dynamic host tools, and steering. |
| Accepted-work durability, actor/route/target authority, privacy, canonical writes, checkpoints, billing/usage persistence, outbox and provider delivery | Murph | These are product and irreversible-effect boundaries, not agent-runtime features. |
| Product-specific host tools | Murph | Codex owns the dynamic-tool protocol; Murph owns consented health/product actions and their authority checks. |
| Generic model catalog and reasoning options | Codex | `model/list` returns the authoritative models, descriptions, modalities, default and supported reasoning efforts, and service tiers. |
| Skill discovery and instruction injection | Codex, after proof | `skills/list`, `skills/changed`, `skills/extraRoots/set`, and skill input items are native. Murph retains authored product skills and admission policy. |
| User-visible progress delivery | Murph | Codex commentary is execution output, not durable delivery to the current messaging route. |
| Specialized research providers | Murph when materially differentiated | Native web search owns generic browsing. A research provider remains justified only for capabilities or evidence quality not provided by native search. |

## Finding 1: exact App Server protocol hard cut

### Evidence

The current protocol boundary is much broader than the deployed protocol:

- `assistant-codex-events.ts` accepts event names from `type`, `method`, or
  `event`; normalizes slash, dot, snake, kebab, and camel variants; accepts
  `agent.message` and `assistant.message`; and deep-searches multiple aliases
  for known fields.
- `assistant-codex/failures.ts` reads thread, turn, status, and error data from
  `params`, `data`, or top-level fields and accepts snake/camel aliases.
- `assistant/providers/helpers.ts` scans several possible completion and usage
  envelopes, OpenAI-style token aliases, snake/camel variants, and both slash
  and dotted notification names.

That behavior silently turns protocol drift into guessed semantics. It also
makes tests prove Murph's compatibility policy instead of the exact Codex
version deployed in production.

### Target architecture

Introduce one narrow internal protocol module for the exact subset of Codex
0.145 messages Murph consumes. It should:

- model canonical request, response, server-request, and notification
  envelopes;
- use exact slash-delimited method names and exact canonical `params` shapes;
- expose small type guards or parsers only at the untrusted JSON boundary;
- treat an unknown future method as unknown rather than guessing that it is a
  known event;
- keep raw events available for bounded diagnostics and product usage
  attribution;
- make a Codex version bump an explicit adapter/test migration.

Do **not** commit the full generated Codex schema or add a custom script that
rewrites generated extensionless imports for Murph's NodeNext build. Either
keep a narrow authored subset mechanically checked against canonical fixtures,
or adopt an upstream packaged schema when it is directly consumable.

### Delete

The implementation should delete, not deprecate:

- event-name separator/casing normalization for known events;
- `type`/`event` fallbacks when canonical App Server messages use `method`;
- `data` and top-level fallbacks for canonical notification parameters;
- deep recursive key searches for known canonical fields;
- dotted event-name support;
- field aliases not emitted by Codex 0.145;
- tests whose only purpose is proving those invented variants.

### Keep

This cut must preserve:

- the stdio JSONL client, request ids, pending request correlation, bounded
  timeouts, and exact process-group teardown;
- App Server initialization and the one resident warm-process owner;
- stale-resume context verification and fresh-thread recovery;
- root-versus-child thread attribution;
- safe progress presentation, redaction, final-message segment assembly, and
  product trace mapping;
- structured Codex error classification, with stderr/text fallback only for a
  real process crash that produced no structured error;
- privacy-safe billed usage extraction, additional child usage, and turn
  profiling;
- dynamic-tool authority and response handling.

### First implementation PR scope

Limit the first code PR to:

1. one exact protocol boundary for the consumed Codex 0.145 messages;
2. event, failure, and usage readers migrated to that boundary;
3. canonical fixtures and existing scripted real-App-Server proof;
4. deletion of compatibility-only tests and helpers.

Do not combine provider renaming, model-catalog changes, skill changes, warm
process lifecycle work, or product tool changes into this PR.

### Acceptance proof

- Focused App Server RPC, runtime, event, failure, usage, child-attribution,
  steering, and compaction tests pass.
- A scripted run against the pinned real `codex app-server` proves
  initialize -> thread start/resume -> turn start -> canonical notifications ->
  terminal completion.
- Unknown notification methods are ignored or surfaced as unknown without
  breaking the turn.
- Searches show no dotted event-name branches or snake/camel aliases remain for
  the migrated canonical structures.
- The source diff is net-negative and introduces no compatibility layer,
  generated-source workflow, or new runtime owner.

## Finding 2: collapse the one-provider abstraction

### Evidence

Murph's internal provider layer is generic in name but singular in behavior:

- `AssistantProviderTargetConfig` is an alias of
  `AssistantCodexTargetConfig`;
- provider resolution accepts only `codex-cli`;
- provider-to-runtime resolution can only return `codex-cli`;
- the model catalog, turn attempt, capabilities, resume, diagnostics, and
  configuration paths are Codex-specific behind generic registry/factory
  vocabulary.

This abstraction does not currently substitute implementations. It mostly
disperses the fact that Codex is the runtime.

### Target architecture

Make Codex the internal execution type and owner. Keep a narrow legacy
projection such as persisted or public `provider: "codex-cli"` only where a
real current consumer requires it. Any temporary compatibility shim must live
on the old boundary and call the new owner; Codex-owned code must not depend
back on the generic layer.

BYO inference remains a Codex **model-provider** configuration. It is not a
reason to retain multiple Murph assistant-runtime providers.

### Delete

Subject to call-site proof, delete:

- provider registries and factories with one member;
- generic provider target unions with one variant;
- capability branching that always resolves to Codex;
- merge/sanitize helpers whose only purpose is hypothetical provider
  selection;
- static empty provider model catalogs;
- generic type names that force adapters but provide no substitution boundary.

Avoid a churn-only rename. The PR qualifies only if it removes branches,
helpers, or ownership indirection.

### Keep

- public or persisted compatibility fields with active consumers;
- provider credential isolation and BYO model-provider configuration;
- usage/pricing attribution by served model and model provider;
- a single stable turn-result boundary needed by callers outside
  `assistant-engine`.

### Sequencing

This is a broader refactor and should follow the protocol hard cut. Recheck
active work that touches provider configuration before starting, especially
the current ChatGPT-auth/provider work. Split external compatibility cleanup
from internal ownership cleanup only when deploy skew or persisted consumers
prove the split necessary.

## Finding 3: native model catalog ownership

### Evidence

The current Murph catalog:

- synthesizes the currently selected model;
- has no meaningful static Codex model inventory;
- hardcodes `low`, `medium`, `high`, and `xhigh` reasoning options;
- infers generic capabilities from Murph-side assumptions.

Codex 0.145 `model/list` returns authoritative model ids, display names,
descriptions, visibility, input modalities, default and supported reasoning
efforts, upgrade information, service tiers, and the default model.

### Target architecture

Use native `model/list` as the one catalog read. Map its response directly to
the small UI/operator view model at the edge.

Do not add a second model-catalog daemon, database table, refresh scheduler, or
long-lived cache. Prefer the already-owned resident App Server when it is
available. For a control surface that currently requires a synchronous catalog,
change that caller deliberately rather than preserving a fake synchronous
catalog forever.

### Delete

- empty static model lists;
- current-model reconstruction as a catalog;
- hardcoded reasoning-option tables;
- duplicated capability inference that `model/list` already supplies;
- catalog/provider glue that becomes dead after the provider hard cut.

### Proof

- The picker renders the exact default, supported efforts, and hidden-model
  policy from a pinned real App Server response.
- No model or reasoning option is invented by Murph.
- App Server unavailability has one explicit control-surface failure state; it
  does not silently fall back to stale hardcoded metadata.
- The migration adds no persistent state owner.

## Finding 4: native skills as the catalog and loader

### Evidence

Murph has two representations of skills:

1. authored `skills/<slug>/SKILL.md` files;
2. a large static `ASSISTANT_SKILLS` array with slugs, names, and routing hints,
   plus prompt-level file references and a custom skills-root environment
   helper.

Codex 0.145 natively supports:

- `skills/extraRoots/set` for standalone skill roots;
- `skills/list` and `skills/changed` for discovery and invalidation;
- a `skill` turn input item that injects the selected skill instructions
  without asking the model to find and read a path.

### Required proof before deletion

The static routing hints may encode product-specific admission distinctions
that do not exist in the current skill metadata. Do not delete them merely
because Codex can list files.

First prove a single-source shape:

- move or derive each routing description from the skill file's native metadata
  or frontmatter;
- have Codex discover the packaged skills root;
- compare native discovery with the complete admitted Murph skill set;
- prove route/capability gating remains a Murph policy input rather than
  filesystem presence becoming authority.

### Target architecture

The skill file is the authored source of truth. Codex owns discovery, change
invalidation, and instruction injection. Murph owns only:

- which skills are admitted for the current product route;
- product-specific eligibility and consent constraints;
- any explicit choice to preload a selected skill.

### Delete after proof

- the duplicated static skill name/slug/description manifest;
- prompt instructions that tell the model to manually read a known skill path;
- custom catalog refresh logic;
- path-building helpers used only for prompt-visible skill loading;
- tests that compare two hand-maintained catalogs instead of checking native
  discovery.

Keep packaging/root setup only to the extent needed to expose the installed
skill tree to `skills/extraRoots/set`.

## Finding 5: lifecycle registration seam

`codex-lifecycle.ts` uses mutable function registration to let another package
stop or await the resident App Server. This is smaller than the findings above,
but it may be removable after the provider hard cut clarifies package ownership.

Pursue this only when the dependency graph permits one direct public owner
without a cycle. Do not move the registry, add an event bus, or create a second
lifecycle service. If direct ownership would make the dependency graph worse,
keep the seam.

## Explicit non-targets

The following are not duplicate runtime work and should not be removed by this
audit:

- **The custom stdio JSON-RPC client.** There is no supported official
  TypeScript App Server client. Migrating to the official TypeScript SDK would
  regress to `codex exec` and lose required App Server behavior.
- **Murph product tools.** Codex owns dynamic-tool transport; Murph must retain
  consent, authorization, validation, canonical writes, and irreversible
  effects for health data, connected apps, messaging, calls, cards, media,
  billing, and groups.
- **Durable progress delivery.** Native commentary is not a route-bound
  iMessage/Telegram/email progress effect.
- **Checkpoint, outbox, leases, accepted-input, and delivery machinery.** These
  protect product durability and authority outside Codex.
- **The stale-resume guard.** A loaded thread can retain stale execution
  context; warm reuse is an optimization and cannot become authority.
- **Compaction policy and accounting.** Murph already calls native
  `thread/compact/start`; the remaining code decides when checkpointing is safe
  and accounts for the work.
- **Subagent persistence and usage attribution.** Murph already uses native
  MultiAgent V2. The remaining bridge protects durable product completion and
  reconciles child usage.
- **Hosted memory policy.** The current decision to disable native memory
  generation while checkpointing any existing Codex memory artifacts is an
  explicit product/privacy policy, not an alternative memory engine.
- **Permission and sandbox policy.** Murph should configure Codex's native
  sandbox/permissions, while retaining route-specific least privilege and
  irreversible-effect authority.
- **Specialized research.** Native web search should own generic browsing.
  Exa or another research path remains only where its corpus, filters, or
  evidence retrieval provides a demonstrated product capability.
- **WebSocket transport.** Codex 0.145 documents it as experimental and
  unsupported. Stdio is the canonical simpler production transport.
- **A generated-schema rewrite pipeline.** Rewriting Codex's generated
  extensionless TypeScript imports for NodeNext would create a new bespoke
  build owner instead of deleting one.
- **Native goals or memory APIs merely because they exist.** Adopt them only
  when their semantics replace a current Murph owner exactly; similar naming is
  not equivalence.

## Execution sequence

### PR A — exact protocol boundary

The first implementation PR described above. It should be behavior-preserving
and net-negative.

### PR B — internal Codex provider hard cut

Collapse generic one-provider machinery after active provider/auth work has
settled. Keep only proven external compatibility.

### PR C — native model catalog

Wire `model/list` into the real catalog caller and delete hardcoded metadata.
This may combine with the final dead catalog cleanup from PR B only if the
result remains one reviewable owner change.

### PR D — skill single-source cut

First land the metadata/discovery proof without adding a second permanent
manifest. Then delete the static manifest and manual path-loading prompt.

### PR E — optional lifecycle seam deletion

Only if the post-hard-cut package graph admits direct ownership with fewer
concepts.

Do not run these as one broad refactor. Each PR must independently reduce
ownership and carry its own focused proof and deletion ledger.

## Cross-PR constraints

- No speculative support for a second assistant runtime.
- No silent compatibility with unpinned Codex protocol variants.
- No new long-lived cache, service, daemon, queue, scheduler, or database table.
- No generated source committed unless it directly replaces more authored code,
  is consumed without rewriting, and has one mechanical version check.
- No product authority may move into a model, prompt, thread, or process.
- No implementation PR may change multiple ownership seams merely to improve
  deletion totals.
- Unknown future Codex capabilities remain unsupported until intentionally
  integrated.
- A Codex upgrade must update the pin, exact fixtures/types, and focused
  real-App-Server proof in the same PR.

## Verification matrix

| Cut | Minimum direct proof |
| --- | --- |
| Exact protocol | Canonical fixture tests plus a real pinned App Server lifecycle; event/failure/usage/child attribution; unknown-notification behavior |
| Provider hard cut | All config/session serialization callers; persisted/public compatibility reads; BYO model-provider selection; usage/pricing attribution |
| Native model catalog | Real `model/list`; default/hidden/modalities/reasoning/service-tier mapping; unavailable state |
| Native skills | Real `skills/extraRoots/set` and `skills/list`; complete inventory; selected skill input injection; route admission remains fail-closed |
| Lifecycle seam | Real acquisition, shutdown, abort/preemption, and checkpoint-boundary cleanup with exactly-once process ownership |

Each implementation PR also requires the routed package typechecks, focused
tests, exact-head CI, and the repository's normal review gates.

## Deletion ledger

Record this table in every implementation PR using base-to-head counts:

| Category | Deleted | Added | Net | Owners removed |
| --- | ---: | ---: | ---: | --- |
| Source | 0 | 0 | 0 | |
| Tests/fixtures | 0 | 0 | 0 | |
| Docs/config | 0 | 0 | 0 | |
| Generated | 0 | 0 | 0 | |
| **Total** | **0** | **0** | **0** | |

Raw line count is not the architecture verdict, but a PR from this audit is not
complete unless it removes at least one concrete compatibility policy,
abstraction, catalog, branch family, or lifecycle owner without adding a
replacement owner.

## Stop condition

This audit is complete when:

1. PR A has hard-cut the adapter to the pinned canonical protocol;
2. the provider layer has one truthful Codex owner with only proven external
   compatibility;
3. native `model/list` owns model/reasoning metadata;
4. skill catalog/loading has one authored source of truth or the proof
   documents exactly why Murph's remaining routing metadata is not duplicate;
5. every rejected deletion above remains explicit, so later cleanup does not
   erase product durability or authority under the banner of trusting Codex.
