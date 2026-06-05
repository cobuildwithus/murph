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
path. The replacement should be explicit, small, and boring: identify the first
root command token, import that command module, mount its normal Incur command
group, and then call `cli.serve(argv)` with the original argv.

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
map to exist by the time `serve()` runs. Therefore the clean Murph-side solution
is to decide which command module to import before `serve()`, then mount a
normal Incur command group and let Incur proceed unchanged.

The Murph code must not:

- parse command-specific arguments;
- parse command-specific options;
- call command handlers directly;
- reconstruct Incur help/schema/LLM output;
- rewrite argv into a different command shape;
- synthesize fake action args for nested commands.

The Murph code may:

- inspect enough argv to identify the first root command token;
- decide that the invocation is global discovery and should load all commands;
- decide that the invocation is setup/onboarding and should load setup;
- mount the chosen command group using the existing registrar;
- call `cli.serve()` with the original argv.

## Target Architecture

### Hot Path

For ordinary command execution:

1. `bin.ts` imports the entrypoint only.
2. `cli-entry.ts` installs process-level behavior that is genuinely global:
   - broken pipe handler;
   - SQLite warning filter;
   - local env file loading;
   - structured error formatting.
3. `cli-entry.ts` determines the program name and the first effective root
   command token using a tiny local helper with no setup, assistant, inbox, or
   vault-service imports.
4. If the invocation is setup/onboarding, import setup and use the setup CLI.
5. Otherwise create the lightweight root Incur shell.
6. Resolve default vault context using operator-config only after the command is
   known to be a data-plane command.
7. Mount only the requested root command family.
8. Call `cli.serve(originalArgv, serveOptions)`.

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

### 1. Add a tiny argv/root routing helper

Candidate file:

- `packages/cli/src/vault-cli-routing.ts`

Responsibilities:

- Detect the effective program name for `murph` vs `vault-cli`.
- Extract the first root command token from argv.
- Detect whether an invocation requires full command registration.
- Detect whether an invocation is a setup/onboarding invocation.

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

Root-token extraction should be deliberately conservative.

It should understand only Incur/global flags that can appear before the root
command:

- `--format <value>`
- `--format=<value>`
- `--json`
- `--full-output`
- `--filter-output <value>`
- `--filter-output=<value>`
- `--token-limit <value>`
- `--token-limit=<value>`
- `--token-offset <value>`
- `--token-offset=<value>`
- `--token-count`
- `--schema`
- `--llms`
- `--llms-full`
- `--help`
- `--version`
- `--mcp`
- `--config <value>`
- `--config=<value>`
- `--no-config`
- `--`

If the helper sees an unknown leading flag before any command token, it should
fall back to full registration rather than guessing. This preserves behavior
for unusual argv ordering such as putting a command option before the command.
It is acceptable for weird ordering to stay slow. The common shape should be
fast.

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
- `['--vault', './vault', 'device', 'account', 'list']` falls back to full.
- `['--', 'device']` does not treat `device` after `--` as a command token.
- `['onboard']` routes setup.
- `['use', './vault']` routes setup only when program name is `murph`.
- `[]` routes setup only when program name is `murph`.

### 2. Split lightweight shell creation away from vault services

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

### 3. Keep setup/onboarding out of normal commands

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

### 4. Add command-family mounting for the hot path

Candidate file:

- `packages/cli/src/vault-cli-command-routing.ts`

This file should be a small explicit map or switch from root command token to
an async function that imports one command family and mounts it on the root CLI.

It must not statically import command modules.

It should not be generic. Avoid filesystem scans, naming conventions, or
plugin-style registration. A small explicit list is easier to review and less
fragile.

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
- `cli.serve()` receives the original argv;
- full registration is an intentional fallback, not the default path.

Root aliases and special top-level commands must be handled explicitly:

- `init`, `validate`, and `vault` mount the vault command family.
- assistant aliases such as `assistant`, `chat`, `run`, `status`, `doctor`, and
  `stop` mount the assistant command family.
- `age` mounts the Murph Age command family.
- health entity commands such as `goal`, `condition`, `allergy`, `blood-test`,
  `family`, and `genetics` mount their corresponding health command family.
- every existing root in the current command topology must have one route or be
  intentionally full-registration-only with a documented reason.

### 5. Preserve the synchronous public CLI builder until it can be simplified

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

This creates a temporary dual path, but it avoids breaking existing API
contracts. Keep the dual path narrow:

- full builder: static full command tree for programmatic/discovery/typegen;
- lazy entrypoint: installed command execution.

Do not add user-facing config around this. Do not add runtime flags. Do not add
environment switches except temporary diagnostic instrumentation if needed.

After the lazy path is stable, evaluate whether `createVaultCli()` can delegate
to shared command-owned registration helpers without the old descriptor
manifest. Do not force that cleanup into the first behavior-preserving cut if it
creates unnecessary risk.

### 6. Delete the descriptor layer from the hot path

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

### 7. Move Health Commons catalog reads deeper

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

### 8. Avoid premature service micro-optimization

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
| `vault-cli --version` | none beyond shell | Must be near Node plus shell startup. |
| `vault-cli --help` | full | Root help should list the full surface. |
| `vault-cli --llms` | full | Root agent discovery needs the full command index. |
| `vault-cli --llms-full` | full | Full manifest is intentionally expensive. |
| `vault-cli device --help` | device only | Scoped help comes from real device Incur group. |
| `vault-cli device account list` | device only | Common hosted runner read path. |
| `vault-cli experiment list` | experiment only | Must not import setup, assistant, inbox, or parse Commons catalog. |
| `vault-cli commons protocol show ...` | commons only | Health Commons cost is legitimate here. |
| `vault-cli init ...` | vault only | Data-plane vault init. |
| `murph init ...` | vault only | Explicit vault override remains allowed only here. |
| `murph onboard ...` | setup only | Setup import is expected. |
| `murph use ...` | setup only | Existing active-vault selection behavior preserved. |
| bare `murph` | setup only | Existing onboarding/default behavior preserved. |
| `murph device account list` | device only | Uses configured default vault before serve. |
| `vault-cli unknown` | full fallback | Preserve Incur suggestions and current error behavior. |
| leading unknown flag before root command | full fallback | Preserve unusual option ordering instead of guessing. |

## Test Plan

### Unit Tests

Add focused tests for the routing helper:

- program name detection;
- root token extraction;
- known global option skipping;
- setup invocation detection;
- full-registration fallback cases;
- root-command alias mapping.

These tests should be small and should not import command modules.

### Wiring Tests

Update or add tests that prove:

- `vault-cli --version` can be served without importing command modules. This
  can be tested with module mocks in source tests or a tiny diagnostic hook in a
  test-only path. Avoid production instrumentation.
- `device account list` mounts only the device registrar.
- `commons protocol show` mounts Commons and still works.
- root `--help` and root `--llms-full` still load the full surface.
- scoped `device --help` does not require unrelated command modules.

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
lane from repo policy:

- `pnpm typecheck`
- `pnpm test:diff <changed paths>` when it truthfully covers the change, or
  `pnpm --dir packages/cli verify:coverage`

Because command topology and generated Incur artifacts are involved, expect the
package-local CLI verification path to be the safer final proof.

Also run direct built CLI smoke checks after build:

- `node packages/cli/dist/bin.js --version`
- `node packages/cli/dist/bin.js --help`
- `node packages/cli/dist/bin.js device --help`
- `node packages/cli/dist/bin.js device account list --vault <fixture>`
- `node packages/cli/dist/bin.js experiment list --vault <fixture>`
- `node packages/cli/dist/bin.js commons protocol list --limit 1`

Use a fixture or temporary vault path that does not contain personal identifiers
and do not print local absolute paths in committed artifacts.

## Implementation Sequence

### Phase 0: Baseline and Guardrails

1. Record current cold timings locally and in the hosted runner container if it
   is available.
2. Add or identify tests that cover:
   - `--version`;
   - root help;
   - scoped help;
   - `device account list`;
   - `experiment list`;
   - Commons commands;
   - generated artifact freshness.
3. Confirm which tests currently import `vaultCliCommandDescriptors`.
4. Decide which descriptor tests should become Incur-surface tests.

Do not edit command architecture until the current behavior surface is clear.

### Phase 1: Lightweight Routing Helpers

1. Add `vault-cli-routing.ts`.
2. Unit test it without importing command modules.
3. Extract setup invocation detection into this helper for the CLI entrypoint.
4. Leave setup package exports alone initially unless there is a clear reason to
   centralize the helper elsewhere.

This phase should be behavior-preserving.

### Phase 2: Lightweight Root Shell

1. Add `vault-cli-shell.ts`.
2. Move shell-only constants and `createVaultCliShell()` there.
3. Update existing bootstrap/full builder imports.
4. Confirm importing the shell does not import vault services, setup, assistant,
   inbox, query, commands, or Health Commons.

This phase should be behavior-preserving.

### Phase 3: Lazy Binary Execution Path

1. Add the small command routing/mounting function.
2. Update `cli-entry.ts` so normal data-plane command execution creates the
   lightweight shell, mounts the requested command family, installs existing
   schema/vault context behavior, and calls Incur.
3. Preserve setup launch behavior after successful onboarding, including
   follow-on `assistant run` and `assistant chat`.
4. Keep `createVaultCli()` unchanged for programmatic full-tree consumers.
5. Make root discovery and unknown commands use full registration.

This is the first phase that should materially reduce latency.

### Phase 4: Health Commons Import Deferral

1. Move `@murphai/health-commons/runtime` top-level imports out of
   `commands/experiment.ts`.
2. Import Commons runtime only inside protocol hydration/defaulting functions.
3. Prove `experiment list` does not construct the generated catalog reader.
4. Prove protocol hydration commands still work.

### Phase 5: Descriptor Deletion

1. Remove `vault-cli-command-manifest.ts` from any remaining hot path.
2. Convert descriptor tests to Incur-surface tests.
3. Delete `leafCommands` metadata if no runtime consumer remains.
4. Delete `directVaultServiceBindings` metadata if no runtime consumer remains.
5. If full static registration still needs a central list, make it a simple
   registration function with static imports, not a descriptor abstraction.

This phase should reduce long-term maintenance risk.

### Phase 6: Generated Artifacts and Package Shape

1. Regenerate Incur config/types after command topology changes.
2. Run package-shape verification.
3. Keep generated artifact changes scoped and explain any intentional topology
   differences in the commit message.

### Phase 7: Final Verification and Measurement

1. Run required typecheck and CLI verification.
2. Run direct built CLI smokes.
3. Re-measure cold timings.
4. Compare against Phase 0.
5. Document remaining costs. Do not add another layer unless the new evidence
   proves it is necessary.

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
- `cli.serve()` still receives original argv.
- Root command routing helper has no heavy imports.
- Root shell module has no heavy imports.
- Setup imports occur only for setup invocations.
- Common data-plane commands do not import assistant/setup/inbox.
- `experiment list` does not parse Health Commons generated catalog.
- Commons commands still work.
- Root discovery still works.
- Scoped discovery still works.
- Generated Incur artifacts are fresh.
- CLI package verification passes.
- Fresh-process timing proves the regression is fixed.

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
