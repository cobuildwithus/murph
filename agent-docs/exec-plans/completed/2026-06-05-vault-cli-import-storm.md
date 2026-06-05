# Vault CLI Import Storm Remediation Plan

Created: 2026-06-05

## Goal

Make ordinary `vault-cli` and `murph` command invocations stop importing the
entire CLI, setup, assistant, inbox, query, Health Commons, and command-schema
graph before dispatch.

The fix must preserve Incur as the command framework. The implementation should
not create a second command parser, a daemon, a cache layer, a persistent
service, a generated command runtime, or a framework on top of Incur. It should
remove the import-coupled architecture that currently exists.

Success criteria:

- `vault-cli --version` does not import the full command graph.
- `vault-cli device account list` imports only the root shell, entrypoint
  routing, device command code, and device service code needed for that
  command family.
- `vault-cli experiment list` does not import setup, assistant, inbox, or parse
  the Health Commons generated catalog.
- `vault-cli commons ...` still imports Health Commons only because the command
  family actually needs it.
- Incur remains responsible for command registration, nested routing, option and
  argument parsing, validation, formatting, help, schema output, LLM manifests,
  MCP behavior, skills behavior, and execution.
- Existing command behavior, output contracts, command topology, built CLI
  package shape, and generated Incur artifacts stay correct.

## Design Principle

Default to deletion and radical simplicity.

The current import storm is not caused by missing infrastructure. It is caused
by too much infrastructure in the hot path:

- A global command manifest imports every command module before dispatch.
- That manifest duplicates leaf-command metadata already owned by Incur command
  definitions.
- The manifest carries service-binding metadata that appears to be test/support
  metadata, not a runtime requirement.
- The entrypoint imports setup code before it knows whether the command is a
  setup command.
- `vault-cli.ts` constructs default inbox and vault services before ordinary
  commands know whether they need those services.

The clean fix is to delete the global, eager command graph from the execution
path. The replacement must stay explicit, small, and boring: remove avoidable
imports first, then only if the measured manifest cost remains material, select
one root command family, mount its normal Incur command group, and call
`cli.serve(argv)` with the same argv Incur receives today.

That selector is not a command parser. It is fail-closed root classification:
a conservative pre-dispatch choice between:

- no command modules for root `--version`;
- setup/onboarding;
- full command registration for root discovery, MCP, unknown, or ambiguous
  invocations;
- one known command family for ordinary execution.

If an invocation is not plainly safe to scope, it must use full registration.

The contract should be this small:

```ts
type CliInvocationPlan =
  | { kind: 'version' }
  | { kind: 'setup' }
  | { kind: 'scoped'; root: KnownRootCommand }
  | { kind: 'full'; reason: string }
```

The classifier must never return command-specific args, command-specific
options, nested command paths, handler inputs, output modes, or rewritten argv.
It only decides which command definitions exist before Incur receives the
invocation.

`--vault` is the one explicit exception to "no argv mutation" because current
behavior already strips Murph-owned `--vault` before Incur parses command args.
The invariant is:

1. extract and validate `--vault` once using the existing semantics;
2. classify the vault-stripped argv;
3. mount the selected or full command set;
4. install schema index, then install vault context so the vault-context wrapper
   remains the outer `serve()` wrapper as it is today;
5. call `cli.serve(vaultStrippedArgv, serveOptions)`.

No other argv normalization is allowed.

## Non-Goals

Do not solve this by adding any of the following:

- A long-lived vault daemon.
- A local HTTP bridge just for CLI speed.
- A command execution cache.
- A Node snapshot or preload cache.
- A bundler-only optimization as the first fix.
- A custom command parser that runs command handlers directly.
- A generic lazy-loading framework with plugin discovery, config, naming
  conventions, decorators, generated files, or dynamic filesystem scans.
- A behavior flag that operators must set to get the fast path.
- A fallback that changes output semantics when lazy routing is active.

Those may be useful only after the import architecture is reduced and measured.
They are not the first fix.

## Evidence

Measured in the hosted runner container during investigation:

- Empty Node process startup is roughly 240-255 ms.
- `vault-cli --version` is roughly 1.4-1.6 s.
- `vault-cli device account list` is roughly 1.3-1.7 s.
- `vault-cli experiment list` is roughly 1.3-1.7 s.
- `vault-cli commons protocol show` is roughly 2.0-2.3 s.
- Importing `vault-cli-command-manifest.js` costs roughly 1.0-1.5 s in a fresh
  process, depending on load.
- Importing `vault-cli.js` costs roughly the same because it imports the
  manifest and service setup.
- `@murphai/setup-cli/setup-cli`, `@murphai/assistant-cli/commands/assistant`,
  `@murphai/inbox-services`, `@murphai/assistant-engine/assistant-state`,
  `@murphai/vault-usecases`, and `@murphai/query` are all material contributors
  to cold import time.
- Health Commons commands have an additional command-specific cost: the
  generated catalog is about 56 MB, and constructing the generated catalog
  reader costs hundreds of milliseconds when it parses that JSON.

The vault itself is small. This is not a large-vault scan problem.

## Current Hot Path

Current command execution starts at `packages/cli/src/bin.ts`:

1. `bin.ts` imports `runMurphCliEntrypoint` from `cli-entry.ts`.
2. `cli-entry.ts` imports lightweight entry helpers at top level, then
   `runMurphCliAction()` dynamically imports:
   - `./vault-cli.js`
   - `@murphai/operator-config/operator-config`
   - `@murphai/setup-cli/setup-cli`
   - `@murphai/operator-config/setup-runtime-env`
3. `vault-cli.ts` imports at top level:
   - `@murphai/inbox-services`
   - `@murphai/assistant-engine/assistant-state`
   - `./vault-cli-bootstrap.js`
   - `./device-services.js`
   - `./vault-cli-command-manifest.js`
   - schema/context helpers
4. `vault-cli-command-manifest.ts` imports all command families and several
   command-output schema packages at top level.
5. `createVaultCliWithOptions()` creates default vault services, default inbox
   services, the Incur root shell, registers every descriptor, installs schema
   index behavior, and installs vault context.
6. Only after all of that does Incur dispatch the one requested command.

That means a device read pays for assistant, setup, inbox, Commons, experiment,
workout, age, model, query, and schema work it does not use.

## Incur Boundary

Incur's public model is:

- `Cli.create(...)`
- `.command(...)` to register a leaf command or mount a command group
- `.serve(argv, options)` to parse, validate, format, and run
- `.fetch(req)` and built-in discovery/transport behavior for framework-owned
  features

Incur does not expose a public lazy command-module loader. It expects a command
map to exist by the time `serve()` runs. Therefore the only Murph-side lazy
option is to decide which command family to import before `serve()`, mount a
normal Incur command group, and let Incur proceed unchanged.

This is acceptable only if Murph does not duplicate Incur command semantics.
The selector may reuse Murph-owned pre-dispatch semantics that already exist
today, such as program-name detection, setup invocation detection, and `--vault`
override extraction. It must not grow a broad Incur flag parser, and it should
not reuse a broader helper when a narrower full-fallback classifier is safer for
lazy loading.

The Murph code must not:

- parse command-specific arguments;
- parse command-specific options;
- parse general Incur discovery/transport flags beyond the minimum needed to
  decide full vs scoped registration;
- inspect nested command names beyond the root token;
- normalize nested aliases;
- call command handlers directly;
- rewrite argv except for the existing Murph-owned `--vault` stripping;
- retry through a different argv shape after failure;
- reproduce Incur error messages;
- reconstruct Incur help/schema/LLM output;
- rewrite argv into a different command shape;
- synthesize fake action args for nested commands.

The Murph code may:

- inspect enough argv to identify the first root command token;
- detect root `--version`;
- decide that the invocation is global discovery and should load all commands;
- decide that the invocation is setup/onboarding and should load setup;
- mount the chosen command group using the existing registrar;
- call `cli.serve()` with the vault-stripped argv that Incur already receives
  today.

## Target Architecture

### Hot Path

For ordinary command execution:

1. `bin.ts` imports the entrypoint only.
2. `cli-entry.ts` installs process-level behavior that is genuinely global:
   - broken pipe handler;
   - SQLite warning filter through the narrow
     `@murphai/runtime-state/node/sqlite-warning-filter` subpath, not the broad
     `@murphai/runtime-state/node` barrel;
   - local env file loading;
   - structured error formatting.
3. `cli-entry.ts` determines the program name and, only for lazy optimization,
   an obvious root command token using a tiny no-heavy-import classifier.
4. If the invocation is setup/onboarding, import setup and use the setup CLI.
5. Otherwise create the lightweight root Incur shell.
6. Resolve default vault context using operator-config only after the command is
   known to be a data-plane command.
7. Mount only the requested root command family.
8. Call `cli.serve(vaultStrippedArgv, serveOptions)`.

### Discovery Path

For root-level discovery or ambiguous invocations:

- root `--help`;
- root `--llms`;
- root `--llms-full`;
- root `--schema`;
- shell completion with no root command;
- unknown root command where Incur suggestions should remain maximally helpful;
- MCP server mode if the full tool list is required;
- generated artifact tooling;

load all commands intentionally and call Incur normally.

This path can be slower because it asks for the full command surface.

### Scoped Discovery Path

For scoped discovery:

- `vault-cli device --help`
- `vault-cli device account list --schema --format json`
- `vault-cli experiment --llms`
- `vault-cli commons protocol show --schema`

mount only that root command family and let Incur generate scoped help/schema
from the real command definitions.

## File-Level Plan

### 0. Narrow root entrypoint imports first

Current issue:

`cli-entry.ts` imports the broad `@murphai/runtime-state/node` barrel only to
install the SQLite warning filter. That broad barrel is allowed for callers that
need runtime-state helpers, but it is too much for `vault-cli --version`.

Target:

- Import `installSqliteExperimentalWarningFilterWithOptions` from
  `@murphai/runtime-state/node/sqlite-warning-filter`.
- Fast-path `--version` directly from the entrypoint without creating an Incur
  shell. Reading package version and writing it is simpler than importing the
  shell, config metadata, or error bridge for a version string.
- Keep root process setup limited to broken-pipe handling, the warning filter,
  env loading, and error formatting.
- Do not import `node:sqlite`, runtime-state filesystem helpers, setup,
  assistant, inbox, vault services, command modules, or Health Commons for
  `vault-cli --version`.

This is deletion-first work. It should be done before adding routing code,
because if a broad root import is responsible for a measurable cost, the
correct fix is to remove that import rather than hide it behind another layer.

### 1. Split vault argv parsing from command wrapping

Current issue:

`extractVaultOverride()` lives in `vault-cli-vault-context.ts`, but that file
also imports Incur and Zod because it mutates registered command definitions to
strip the `vault` option from help/schema and inject the selected vault at run
time. The entrypoint needs vault argv handling before it should pay for Incur,
Zod, or command mutation code.

Target:

- Move the pure argv logic into a tiny module, for example
  `packages/cli/src/vault-cli-vault-argv.ts`.
- Keep support for `--vault <path>` and `--vault=<path>` exactly as today.
- Keep duplicate/missing-value validation exactly as today.
- Import that tiny module from both the entrypoint and
  `vault-cli-vault-context.ts`.
- Leave `createVaultCliVaultContext()` and `installVaultCliVaultContext()` in
  the command-context module where Incur/Zod imports are actually needed.

This avoids importing Incur/Zod command-wrapping code just to identify the
effective root token or serve `--version`.

### 2. Add a tiny pre-dispatch selector

Candidate file:

- `packages/cli/src/vault-cli-routing.ts`

Responsibilities:

- Detect the effective program name for `murph` vs `vault-cli`.
- Apply Murph-owned `--vault` override stripping exactly as today.
- Identify an obvious first root command token for hot-path optimization.
- Detect whether an invocation requires full command registration.
- Detect whether an invocation is a setup/onboarding invocation.
- Return only a routing decision, never parsed command arguments or options.

This file must not import:

- `@murphai/setup-cli/*`
- `@murphai/assistant-cli/*`
- `@murphai/assistant-engine/*`
- `@murphai/inbox-services`
- `@murphai/vault-usecases`
- `@murphai/query`
- `@murphai/health-commons/*`
- any command module

Allowed imports:

- Node built-ins, such as `node:path`.
- Very small local helpers, only after measurement proves they do not import
  the heavy graph.

Root classification should be deliberately conservative and should not become a
copy of Incur's parser. It is a performance hint, not the owner of command
semantics.

Do not reuse `resolveEffectiveTopLevelToken()` directly for the lazy selector.
That helper is current behavior for setup/default-vault decisions, including
its `--` handling, but lazy classification can safely be narrower. The selector
should fast-path only obvious command-first shapes plus a tiny stable global
prefix allowlist, then full-register everything else.

The tiny allowlist may include only stable root/global syntax needed by measured
hot paths, such as:

- `--vault <path>` and `--vault=<path>` using the extracted Murph-owned vault
  argv helper;
- `--format <value>` and `--format=<value>`;
- `--json`;
- `--full-output`;
- `--filter-output <value>` and `--filter-output=<value>`;
- `--token-limit <value>` and `--token-limit=<value>`;
- `--token-offset <value>` and `--token-offset=<value>`;
- `--token-count`;
- `--config <value>` and `--config=<value>`;
- `--no-config`.

Root-level discovery and built-ins are full-registration paths. Unknown leading
flags are full-registration paths. `--` before the root is a full-registration
path unless a focused compatibility test proves scoped behavior is exactly
equivalent.

The selector may handle Murph-owned `--vault` / `--vault=<path>` before root
selection because that behavior is already owned by `vault-cli`, and hosted
runner smoke paths use leading `--vault`. It should reuse or extract
`extractVaultOverride()` semantics rather than reimplementing a different
`--vault` parser.

The selector must treat root-level discovery and transport modes as full
registration unless scoped by an already identified root command:

- root `--help`, `--llms`, `--llms-full`, or `--schema`;
- `--mcp`;
- root `skills ...`;
- root `skill ...`;
- root `mcp ...`, including `mcp add`;
- root `completions ...`;
- dynamic completion mode when `COMPLETE` is set;
- shell completion callbacks with no clear root command;
- unknown or ambiguous leading flags before any command token.

It is acceptable for unusual ordering to stay slow. The common command shapes
should be fast, especially:

- `vault-cli device account list --vault <fixture>`;
- `vault-cli --vault <fixture> device account list`;
- `vault-cli experiment list --vault <fixture>`;
- `vault-cli --vault=<fixture> experiment list`.

The helper must not try to understand nested commands such as
`device account list`. Once it identifies `device`, it is done.

Test cases:

- `[]`
- `['--version']`
- `['--help']`
- `['--llms-full']`
- `['device', 'account', 'list']`
- `['--format', 'json', 'device', 'account', 'list']`
- `['--format=json', 'device', 'account', 'list']`
- `['device', '--help']`
- `['device', 'account', 'list', '--schema', '--format', 'json']`
- `['--vault', './fixture-vault', 'device', 'account', 'list']` routes device.
- `['--vault=./fixture-vault', 'experiment', 'list']` routes experiment.
- `['device', 'account', 'list', '--vault', './fixture-vault']` routes device.
- `['--', 'device']` uses full registration unless a focused compatibility test
  proves scoped behavior is exactly equivalent for this shape.
- `['skills', 'add']` uses full registration unless Incur exposes a scoped
  skills mode that is proven equivalent.
- `['completions', 'bash']` uses full registration.
- `['--mcp']` uses full registration.
- `['onboard']` routes setup.
- `['use', './vault']` routes setup only when program name is `murph`.
- `['--config', './config.json', 'use', './vault']` routes setup only when
  program name is `murph`.
- `[]` routes setup only when program name is `murph`.

### 3. Split lightweight shell creation away from vault services

Current file:

- `packages/cli/src/vault-cli-bootstrap.ts`

Problem:

It imports `@murphai/vault-usecases` just to export
`createDefaultVaultServices()`. Because `vault-cli.ts` imports this file before
dispatch, creating a root shell also pulls vault services.

Target:

Create a lightweight shell module, for example:

- `packages/cli/src/vault-cli-shell.ts`

It should contain only:

- `CLI_DESCRIPTION`
- `CLI_CONFIG_FILES`
- package version loading
- `createVaultCliShell(commandName)`
- `incurErrorBridge` installation

It may import:

- `node:module`
- `incur`
- `./incur-error-bridge.js`

It must not import:

- vault services;
- inbox services;
- assistant state;
- setup CLI;
- command modules;
- Health Commons runtime;
- query.

Then either:

- leave `vault-cli-bootstrap.ts` as the heavier service bootstrap file that
  imports `createVaultCliShell()` from `vault-cli-shell.ts`; or
- delete `vault-cli-bootstrap.ts` if all remaining responsibilities have clearer
  owners.

Prefer deletion if the split leaves `vault-cli-bootstrap.ts` as a thin alias.

### 4. Keep setup/onboarding out of normal commands

Current issue:

`cli-entry.ts` imports `@murphai/setup-cli/setup-cli` before it knows whether
the command is setup. That import pulls setup wizard, assistant setup, assistant
state, inbox services, vault-usecases, and tool provisioning.

Target:

- `cli-entry.ts` uses the new lightweight routing helper to decide whether this
  is setup.
- Only setup invocations import `@murphai/setup-cli/setup-cli`.
- Normal commands never import setup.

Preserve behavior:

- `vault-cli onboard ...` routes setup.
- `murph onboard ...` routes setup.
- `murph use ...` routes setup.
- bare `murph` routes setup/onboarding behavior exactly as today.
- `murph init` remains the data-plane vault init path where explicit `--vault`
  is allowed.
- `vault-cli init` remains data-plane vault init, not setup.

Do not move the whole setup CLI into the data-plane package. Do not make setup
part of the normal command graph.

### 5. Add command-family mounting for the hot path

Candidate file:

- `packages/cli/src/vault-cli-command-routing.ts`

This file should be a small explicit map or switch from root command token to
an async function that imports one command family and mounts it on the root CLI.

It must not statically import command modules.

It should not be generic. Avoid filesystem scans, naming conventions, or
plugin-style registration. A small explicit list is easier to review and less
fragile. It must also not become descriptor metadata: no leaf command paths, no
duplicated descriptions, no duplicated schemas, no service-binding registry, and
no command-specific option knowledge.

First shippable scope should be deliberately small:

- `device`;
- `experiment`;
- `commons`;
- core vault roots needed by the measured paths, such as `init`, `validate`,
  and `vault`.

All other roots may full-fallback in the first cut with a documented reason.
Do not eagerly build a complete second root topology. Add more lazy roots only
after measurement proves they matter or descriptor deletion makes the command
owned registrar list the single topology source.

Example shape:

```ts
export async function registerRequestedVaultCliCommands(input: {
  cli: Cli.Cli
  rootCommand: string | null
  services?: VaultServices | CliVaultServices
  inboxServices?: InboxServices
}): Promise<RegisterRequestedVaultCliCommandsResult> {
  switch (input.rootCommand) {
    case 'device': {
      const [{ registerDeviceCommands }, { createIntegratedDeviceSyncServices }] =
        await Promise.all([
          import('./commands/device.js'),
          import('./device-services.js'),
        ])
      registerDeviceCommands(input.cli, createIntegratedDeviceSyncServices())
      return { mode: 'scoped', rootCommand: 'device' }
    }
    case 'commons': {
      const { registerCommonsCommands } = await import('./commands/commons.js')
      registerCommonsCommands(input.cli)
      return { mode: 'scoped', rootCommand: 'commons' }
    }
    default:
      await registerAllVaultCliCommands(input)
      return { mode: 'full' }
  }
}
```

The final implementation does not need this exact interface. The important
rules are:

- one root token maps to one imported command family;
- import functions are explicit;
- Incur command definitions remain inside the command modules;
- `cli.serve()` receives the vault-stripped argv;
- full registration is an intentional fallback, not the default path.
- full and lazy paths should call command-owned registrars, not separate
  descriptor-owned implementations.

Root aliases and special top-level commands outside the first shippable scope
must either be handled explicitly or documented as full-only:

- `init`, `validate`, and `vault` mount the vault command family in the first
  cut if they are part of the measured raw-vault flow.
- assistant aliases such as `assistant`, `chat`, `run`, `status`, `doctor`, and
  `stop` may stay full-only initially.
- `age` may stay full-only initially.
- health entity commands such as `goal`, `condition`, `allergy`, `blood-test`,
  `family`, and `genetics` may stay full-only initially.
- every existing root in the current command topology must have one lazy route
  or be intentionally full-registration-only with a documented reason before the
  lazy entrypoint is accepted.

### 6. Preserve the synchronous public CLI builder until it can be simplified

Current public behavior:

- `packages/cli/src/index.ts` default-exports `createVaultCli()`.
- `incur gen` uses the built `dist/index.js` entrypoint.
- Many tests call `createVaultCli()` synchronously.
- Package-shape verification expects generated Incur artifacts to match the
  built static CLI entrypoint.

Changing `createVaultCli()` from synchronous to asynchronous would be a public
API break and would cause broad test churn. Do not do that as part of the first
performance fix.

Instead:

- Keep `createVaultCli()` as the full static builder for programmatic use,
  tests, and `incur gen`.
- Move the installed binary hot path to a new lazy execution path inside
  `cli-entry.ts`.
- Ensure root runtime discovery commands that need the full surface can still
  call full registration.
- Make both full and lazy registration call command-owned registrar functions.
  The lazy route table may choose a registrar, but it must not own command
  metadata.

This creates a temporary dual path, but it avoids breaking existing API
contracts. Keep the dual path narrow:

- full builder: static full command tree for programmatic/discovery/typegen,
  assembled from the same command-owned registrars;
- lazy entrypoint: installed command execution, selecting a subset of those
  registrars.

The temporary state must not leave three topology authorities: old descriptor
manifest, new lazy route table, and command modules. If the descriptor manifest
must remain briefly for `createVaultCli()`, keep it out of the lazy path and do
not add new behavior to it. The deletion target is command-owned registrars as
the single command-topology source.

Do not add user-facing config around this. Do not add runtime flags,
environment switches, or production diagnostic hooks for lazy loading.

After the lazy path is stable, evaluate whether `createVaultCli()` can delegate
to shared command-owned registration helpers without the old descriptor
manifest. Do not force that cleanup into the first behavior-preserving cut if it
creates unnecessary risk.

### 7. Delete the descriptor layer from the hot path

Current file:

- `packages/cli/src/vault-cli-command-manifest.ts`

Current responsibilities:

- imports every command module;
- imports output schemas from many packages;
- defines descriptor ids and root command names;
- duplicates leaf command paths, descriptions, hints, and outputs;
- stores direct vault service binding metadata;
- validates descriptor uniqueness;
- registers all command descriptors.

Runtime does not need most of this. Incur command modules already own command
definitions. The descriptor file should not be imported during ordinary command
execution.

First cut:

- Remove `vault-cli-command-manifest.ts` from the installed binary hot path.
- Keep it only if needed by the synchronous full builder and generated artifact
  tooling during the transition.
- Do not add new descriptor metadata to support lazy routing.
- Do not let the lazy route table duplicate `leafCommands`,
  `directVaultServiceBindings`, descriptions, output schemas, or nested paths.
- Prefer extracting plain full-registration functions that call command-owned
  registrars over preserving the descriptor list as the long-term full builder.

Final cleanup target:

- Delete duplicated `leafCommands` metadata.
- Delete `directVaultServiceBindings` metadata unless a real runtime consumer is
  identified.
- Convert tests that import descriptor metadata to tests against real Incur
  output (`--llms-full`, `--schema`, generated types, or command execution).
- Prefer tests that prove user-visible command surface over tests that preserve
  the manifest implementation.

If any descriptor metadata is still genuinely needed, split it into a small
metadata-only file that contains plain strings and no command implementation
imports. Do this only after proving the need. The default is deletion.

### 8. Move Health Commons catalog reads deeper

Problem:

`packages/cli/src/commands/experiment.ts` imports
`@murphai/health-commons/runtime` at top level, but common commands such as
`experiment list` do not need the generated catalog reader.

Target:

- Keep `commands/commons.ts` importing Health Commons runtime because the
  Commons command family is explicitly about Commons.
- In `commands/experiment.ts`, replace top-level Health Commons runtime import
  with a local dynamic import inside the functions that hydrate protocol
  defaults or resolve Health Commons protocol details.
- Do not parse the 56 MB generated catalog for `experiment list`, `experiment
  show`, or other commands that do not need public protocol hydration.

Testing:

- `experiment list` must still work without triggering catalog reader creation.
- `experiment edit --hydrate-protocol-defaults` and related protocol hydration
  paths must still load and use the catalog.
- Commons commands must retain current behavior and output contracts.

### 9. Avoid premature service micro-optimization

The first-order cost is eager command-family import. Do not split every service
package before measuring the lazy command path.

However, the implementation should avoid creating services that are clearly not
needed:

- Device commands can use `createIntegratedDeviceSyncServices()` instead of
  creating the full vault service set if the current command registrar only
  needs `DeviceSyncServices`.
- Commons commands do not need vault services.
- Pure utility commands such as route/model/automation should create only what
  they need.
- Assistant commands should create inbox services only when mounting assistant
  command roots.

Measure after root-family lazy loading before performing deeper service splits.
If service creation remains expensive, split at real ownership boundaries, not
around timing anecdotes.

## Behavior Preservation Matrix

| Invocation | Expected registration | Notes |
| --- | --- | --- |
| `vault-cli --version` | version | Direct version output; no Incur shell or command graph. |
| `vault-cli --help` | full | Root help should list the full surface. |
| `vault-cli help` | full | Preserve current root-help/unknown-command behavior intentionally. |
| `vault-cli --llms` | full | Root agent discovery needs the full command index. |
| `vault-cli --llms-full` | full | Full manifest is intentionally expensive. |
| `vault-cli --mcp` | full | MCP should expose the complete tool list unless Incur later provides a proven scoped mode. |
| `vault-cli skills ...` | full | Incur-owned skill behavior should not be reimplemented. |
| `vault-cli skill ...` | full | Treat possible Incur skill aliases as framework-owned. |
| `vault-cli mcp ...` | full | Incur-owned MCP registration behavior should not be reimplemented. |
| `vault-cli completions ...` | full | Root completion setup depends on the command map and built-ins. |
| `COMPLETE=<shell> vault-cli ...` | full | Dynamic completion should see the full tree until scoped completion is proven. |
| `vault-cli device --help` | device only | Scoped help comes from real device Incur group. |
| `vault-cli device account list` | device only | Common hosted runner read path. |
| `vault-cli --vault <fixture> device account list` | device only | Leading explicit vault is a common hosted-runner shape and must stay fast. |
| `vault-cli device account list --vault <fixture>` | device only | Existing trailing explicit-vault behavior preserved. |
| `vault-cli experiment list` | experiment only | Must not import setup, assistant, inbox, or parse Commons catalog. |
| `vault-cli --vault=<fixture> experiment list` | experiment only | Leading `--vault=` stays on the scoped path. |
| `vault-cli commons protocol show ...` | commons only | Health Commons cost is legitimate here. |
| `vault-cli init ...` | vault only | Data-plane vault init. |
| `murph init ...` | vault only | Explicit vault override remains allowed only here. |
| `murph --version` | version | Direct version output, no setup import. |
| `murph --help` | full | Product root discovery should not route to setup by accident. |
| `murph help` | setup or full by explicit current-behavior test | Current setup routing treats `help` as setup-owned for `murph`; preserve or intentionally change with a test. |
| `murph --llms-full` | full | Root agent discovery needs the full command index. |
| `murph onboard ...` | setup only | Setup import is expected. |
| `murph use ...` | setup only | Existing active-vault selection behavior preserved. |
| `murph --config <path> use ...` | setup only | Config prefix should not hide the setup-owned `use` command. |
| bare `murph` | setup only | Existing onboarding/default behavior preserved. |
| `murph device account list` | device only | Uses configured default vault before serve. |
| `vault-cli unknown` | full fallback | Preserve Incur suggestions and current error behavior. |
| leading unknown flag before root command | full fallback | Preserve unusual option ordering instead of guessing. |
| `vault-cli -- device` | current behavior or full fallback | Must be covered by an explicit compatibility test before changing behavior. |

## Test Plan

### Unit Tests

Add focused tests for the routing helper:

- program name detection;
- fail-closed root token classification;
- leading and trailing `--vault` / `--vault=<path>` stripping;
- root discovery and MCP full-registration decisions;
- root Incur built-in decisions for `skills`, `skill`, `mcp`,
  `completions`, and `COMPLETE`;
- setup invocation detection;
- full-registration fallback cases;
- root-command alias mapping.

These tests should be small and should not import command modules.

### Wiring Tests

Update or add tests that prove:

- `vault-cli --version` can be served without importing command modules.
- `device account list` mounts only the device registrar.
- `commons protocol show` mounts Commons and still works.
- root `--help` and root `--llms-full` still load the full surface.
- scoped `device --help` does not require unrelated command modules.
- lazy execution mounts commands before installing schema/vault context, because
  `installVaultCliVaultContext()` only mutates commands already registered.
- scoped schemas and LLM manifests hide `--vault`, while command execution still
  injects the selected vault.
- setup follow-on actions prove the same invariant for `device connect`,
  `assistant run`, and `assistant chat`: either each follow-on uses a fresh
  shell/mount/wrap/serve dispatch, or all follow-on roots are mounted before
  wrappers are installed.
- root schema and root LLM output full-register before schema-index behavior
  runs, because the schema index is derived from the currently registered
  command map and uses `--llms-full` internally.
- schema-index fallback does not override Incur help precedence for combined
  `--help --schema --format json`; when `--help` or `-h` is present, help wins.
- every full CLI root is either lazily routable in the first slice or listed as
  full-only with a reason.
- programmatic `createVaultCli().fetch(...)` still handles vault override and
  injection on the full-builder path.

Add a built-runtime fresh-process import sentinel. It should execute
`node packages/cli/dist/bin.js ...` in a new process and fail if hot paths load
modules they should not load. Do not rely on Vitest module mocks or the
persistent CLI harness for this proof, because both can hide cold-start import
behavior.

The sentinel should cover at least:

- `--version` does not load `vault-cli-command-manifest`, command modules,
  setup, assistant, inbox, Health Commons runtime, or `node:sqlite`.
- `device account list` does not load setup, assistant, inbox, Commons command
  modules, or Health Commons runtime.
- `experiment list` does not load setup, assistant, inbox, Commons command
  modules, or Health Commons runtime.
- `commons protocol show` may load Health Commons runtime but should not load
  setup, assistant, or inbox.

Keep the sentinel test-only. Do not add production instrumentation, env flags,
or user-visible diagnostics for this.

### Incur Surface Tests

The lazy route table must prove more than root names. Add focused built or
source tests for Incur-owned surfaces:

- `vault-cli device --schema --format json`
- `vault-cli experiment --llms --format json`
- `vault-cli commons protocol show --schema --format json`
- shell completion callback behavior for root and scoped commands
- `vault-cli --mcp`
- `vault-cli skills ...`

Root MCP and skills may stay full-registration paths. The important invariant is
that Murph does not reimplement those Incur surfaces.

### Health Commons Tests

Deferral must be proven in both directions:

- `experiment list` and `experiment show` do not load Health Commons runtime or
  construct the generated catalog reader.
- `experiment start --from-protocol ...` loads and uses Health Commons runtime.
- `experiment edit --hydrate-protocol-defaults ...` loads and uses Health
  Commons runtime.
- Editing an already protocol-backed experiment to another protocol either
  keeps `commonsProtocolRef` and
  `effectiveProtocolSnapshot.effectiveSpecHash` consistent or rejects the edit.

### Existing Test Migration

Tests that import `vaultCliCommandDescriptors` should be reviewed. If they are
only preserving descriptor implementation details, replace them with tests
against user-visible Incur surfaces.

Examples:

- Replace leaf path assertions with `--llms-full --format json` assertions.
- Replace output schema presence assertions with `--schema --format json` for
  the actual leaf command.
- Replace direct service binding metadata assertions with focused command tests
  that prove the command calls the expected service seam.

Do not preserve the descriptor layer just because tests assert it.

### Generated Artifacts

Because the CLI topology changes, run the normal generated artifact path:

- `pnpm --dir packages/cli gen:config-schema`

Then verify:

- `packages/cli/config.schema.json` remains in sync.
- `packages/cli/src/incur.generated.ts` remains in sync.
- package-shape verification still passes.

If the first implementation leaves `createVaultCli()` as the synchronous full
builder, generated artifacts should not materially change except where tests or
command topology are intentionally cleaned up.

### Performance Proof

Add or run a local script that measures fresh-process timings for:

- empty Node process;
- `node packages/cli/dist/bin.js --version`;
- `node packages/cli/dist/bin.js device account list --vault <fixture>`;
- `node packages/cli/dist/bin.js experiment list --vault <fixture>`;
- `node packages/cli/dist/bin.js commons protocol list --limit 1`;
- import time for the new lightweight shell module;
- import time for the lazy routing helper;
- import time for individual scoped command modules.

The plan does not require committing a benchmark script unless it is small and
useful for future regression prevention. Prefer using existing test helpers or
a temporary local measurement first.

Acceptance targets should be relative, not absolute:

- `--version` should no longer be dominated by command graph import.
- `device account list` should no longer import assistant/setup/inbox/commons.
- `experiment list` should no longer parse the Commons catalog.
- Commons commands should remain the outlier only because they legitimately
  load Commons data.

### Required Verification

For the implementation change under `packages/cli`, use the CLI verification
lane from repo policy. Because this change is specifically about the built
binary cold-start path and generated Incur/package shape, source-first
`pnpm test:diff` is not sufficient as final proof.

- `pnpm typecheck`
- `pnpm --dir packages/cli verify:coverage`

If `verify:coverage` is blocked by a credibly unrelated existing failure, the
minimum scoped replacement is:

- `pnpm build:test-runtime:prepared`
- `pnpm --dir packages/cli verify:package-shape`
- the focused built-runtime import sentinel and direct smokes from this plan

Because command topology and generated Incur artifacts are involved, expect the
package-local CLI verification path to be the safer final proof.

Also run direct built CLI smoke checks after build:

- `node packages/cli/dist/bin.js --version`
- `node packages/cli/dist/bin.js --help`
- `node packages/cli/dist/bin.js help`
- `node packages/cli/dist/bin.js device --help`
- `node packages/cli/dist/bin.js device account list --vault <fixture>`
- `node packages/cli/dist/bin.js --vault <fixture> device account list`
- `node packages/cli/dist/bin.js experiment list --vault <fixture>`
- `node packages/cli/dist/bin.js --vault=<fixture> experiment list`
- `node packages/cli/dist/bin.js commons protocol list --limit 1`

Compare key lazy-bin outputs against the full-builder path for representative
commands, especially scoped help/schema/LLM output and root discovery output.
Generated/package-shape checks prove `dist/index.js`; these comparisons prove
the installed lazy binary behaves the same where it should.

Use a fixture or temporary vault path that does not contain personal identifiers
and do not print local absolute paths in committed artifacts.

## Implementation Sequence

### Cut 0: Baseline and root cleanup

1. Record current cold timings locally and in the hosted runner container if it
   is available.
2. Narrow the runtime-state warning-filter import.
3. Split pure `--vault` argv extraction away from vault-context command
   wrapping.
4. Fast-path `--version` directly without creating an Incur shell.
5. Split lightweight shell creation away from service bootstrap.
6. Defer setup imports for obvious non-setup invocations.
7. Confirm these changes do not import vault services, setup, assistant, inbox,
   query, commands, or Health Commons for `--version`.

This cut is deletion-first. If it removes enough latency for the current need,
stop and do not add lazy root classification.

### Cut 1: Lazy entrypoint for measured hot roots

1. Add `classifyVaultCliInvocation()` or equivalent. Keep the name about
   classification, not parsing.
2. Add the small command-family mounting function for measured hot roots only:
   `device`, `experiment`, `commons`, and the core vault roots needed by raw
   vault smoke paths.
3. Make normal data-plane command execution:
   - extract `--vault` once;
   - classify the vault-stripped argv;
   - create the lightweight shell;
   - mount the selected or full command set;
   - install schema index;
   - install vault context so it remains the outer serve wrapper;
   - call Incur with the vault-stripped argv.
4. Preserve setup launch behavior after successful onboarding by running
   follow-on `device connect`, `assistant run`, or `assistant chat` through a
   fresh shell/mount/wrap/serve dispatch, or by mounting every needed follow-on
   root before installing wrappers. Prefer fresh dispatch because it keeps the
   wrapper invariant obvious and avoids reusing a partially wrapped shell.
5. Route root discovery, Incur built-ins, completion mode, unknown roots, and
   ambiguous leading flags to full registration.
6. Keep `createVaultCli()` synchronous for programmatic full-tree consumers, but
   make full registration use the same command-owned registrars where possible.
7. Add route parity as a Cut 1 acceptance test: every full CLI root is either
   lazily routable or documented full-only.

This cut is the first one that should materially reduce ordinary command
latency. Do not add broad route coverage until measurements prove the smaller
slice is insufficient.

### Cut 2: Health Commons deferral and final proof

1. Move `@murphai/health-commons/runtime` top-level imports out of
   `commands/experiment.ts`.
2. Import Commons runtime only inside protocol hydration/defaulting functions.
3. Prove `experiment list` and `experiment show` do not construct the generated
   catalog reader.
4. Prove protocol-backed start/edit/hydration commands still load and use the
   catalog correctly.
5. Regenerate Incur config/types after command topology changes.
6. Run package-shape verification and required CLI coverage.
7. Run direct built CLI smokes and fresh-process import sentinels.
8. Compare representative lazy-bin outputs against the full-builder outputs.
9. Re-measure cold timings and compare against the baseline.

`experiment list` is part of the success criteria, so this is not optional
cleanup for the first shippable performance fix.

### Follow-Up: Descriptor deletion

After the lazy binary path is proven:

1. Remove `vault-cli-command-manifest.ts` from any remaining hot path.
2. Convert descriptor tests to Incur-surface tests.
3. Delete `leafCommands` metadata if no runtime consumer remains.
4. Delete `directVaultServiceBindings` metadata if no runtime consumer remains.
5. If full static registration still needs a central list, make it a simple
   registration function with static imports, not a descriptor abstraction.

Do this as a follow-up unless it is mechanically smaller during the first cut.
The first fix should not combine latency remediation with a broad descriptor
rewrite if that increases risk.

## Failure Modes To Avoid

### Accidentally Parsing Commands Twice

The routing helper must not parse nested command semantics. It should only
select the root command family. Incur remains the parser.

### Divergent Lazy vs Full Command Surfaces

The lazy route table must be tested against the full command surface. Every root
command that exists in full registration must either have a lazy route or an
explicit full-registration fallback reason.

A test can compare root command names from:

- full Incur manifest output; and
- the lazy route table's declared roots.

This test should compare names, not implementation descriptors.

### Breaking `incur gen`

`incur gen` currently uses the built `dist/index.js` default export. Keep that
path working. Do not make `createVaultCli()` async in the first cut.

### Breaking Root Help

Root help should continue to show the full command list. It may load all
commands intentionally.

Scoped help should remain fast and complete for the selected group.

### Breaking Setup

The setup package currently owns real setup behavior. The CLI entrypoint should
only copy or extract the tiny setup-routing predicate. It should not import or
reimplement setup workflows.

Setup follow-ons must preserve vault-context wrapping. Either each follow-on
uses a fresh shell/mount/wrap/serve dispatch, or every follow-on root is mounted
before schema/vault wrappers are installed.

### Breaking Vault Injection

`installVaultCliVaultContext()` mutates commands already registered. Lazy
execution must mount the selected or full command set before installing vault
context. It must call Incur with the vault-stripped argv that current behavior
already uses, and it must not perform any other argv rewrite.

### Breaking Schema Help Precedence

The schema-index wrapper should not override Incur help behavior for combined
`--help --schema --format json` requests. If help is present, help should win.

### Keeping Descriptor Metadata Because Tests Use It

Tests are not product requirements. If a descriptor exists only because tests
assert it, delete or rewrite the test.

### Over-Optimizing Service Internals Too Early

After root-family lazy loading, measure again. Do not split packages just
because they are on a list. Split only where a command still imports a large
unrelated owner package that the command does not need.

## Review Checklist

Before landing implementation:

- No new persistent process or daemon was added.
- No new dependency was added.
- No user-facing flag or config toggle was added for lazy loading.
- No command handler is called outside Incur.
- `cli.serve()` receives the vault-stripped argv and no other rewritten argv.
- Root classification helper has no heavy imports.
- Root shell module has no heavy imports.
- Setup imports occur only for setup invocations.
- Common data-plane commands do not import assistant/setup/inbox.
- `experiment list` does not parse Health Commons generated catalog.
- Commons commands still work.
- Root discovery still works.
- Scoped discovery still works.
- Incur built-ins and completion modes full-register or have proven scoped
  equivalence.
- Setup follow-ons preserve vault injection and hidden `--vault`.
- Generated Incur artifacts are fresh.
- CLI package `verify:coverage` passes, or the documented built-runtime scoped
  replacement is run because of an unrelated blocker.
- Fresh-process import sentinels and timing prove the regression is fixed.

## Expected End State

The end state should be simpler than today:

- Command modules own command definitions.
- Incur owns command semantics.
- The binary entrypoint owns only process setup, vault context, and selecting
  which command family to mount.
- Root discovery intentionally loads all commands.
- Ordinary commands load one family.
- The duplicated global descriptor manifest is gone from the hot path and
  ideally gone from the codebase.

If the implementation starts to require a registry framework, generated lazy
loader, command plugin protocol, or command metadata DSL, stop and simplify. The
current problem is that we already have too much pre-dispatch structure.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
