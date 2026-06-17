# Incur Payload Schema Migration Guide

Status: active migration guide
Last verified: 2026-06-17

## Purpose

Make Murph's agent-writable JSON payloads discoverable without fighting Incur's
command model. Incur should continue to describe command arguments, options,
environment variables, and outputs. Murph should expose file and JSONL payload
contracts as first-class Murph command outputs.

## Short Answer

The current concern is true: `--schema` is not enough for deep writable payloads.
For commands that accept `--input @file.json|-`, Incur can only see the `input`
option. It cannot infer the JSON file body behind that string.

`scaffold` helps, but only as an example generator. Today the shared health
scaffold schema exposes `payload` as an open object, and several scaffold
commands intentionally return representative starter payloads rather than exact
writable contracts. Agents can copy a scaffold, but they cannot validate or
generate every supported nested shape from it.

## Evidence From Incur

Murph currently uses `incur@0.4.5` in the CLI packages. The upstream Incur docs
describe discovery around command arguments, options, environment variables, and
outputs. They do not describe a separate hidden file-body schema surface:
https://github.com/wevm/incur

The local Incur implementation matches that contract:

- `packages/cli/node_modules/incur/src/Cli.ts` implements `--schema` as JSON
  Schema for `cmd.args`, `cmd.env`, `cmd.options`, and `cmd.output`.
- `packages/cli/node_modules/incur/src/Mcp.ts` builds each MCP tool input schema
  by merging command `args` and `options`.
- `packages/cli/node_modules/incur/src/SyncSkills.ts` emits skill metadata for
  command description, args, env, hint, options, output, and examples.
- Incur command definitions include `args`, `options`, `env`, `output`, `fetch`,
  examples, and formatting fields. There is no command-file-body field for
  `--input @file.json`.

That means this command schema is expected:

```text
vault-cli condition import-json --schema --format json
```

It can describe `--input`. It cannot describe the condition payload stored in
that input file unless Murph creates a command whose output is that payload
schema.

## Evidence From Murph

The Murph wrappers do not currently fill this gap:

- `packages/cli/src/vault-cli-schema-index.ts` returns a command index for group
  `--schema` requests and tells agents to inspect a leaf command schema. That
  still lands on Incur's args/options/output schema.
- `packages/cli/src/vault-cli-llms-normalizer.ts` normalizes `--llms` output and
  injects existing hints, but does not add deep payload contracts.
- `packages/cli/src/commands/command-factory-primitives.ts` maps shared
  `import-json` commands to one `input` option.
- `packages/vault-usecases/src/json-input.ts` defines that option as a string
  reference in `@file.json` or `-` form.
- `packages/vault-usecases/src/health-cli-descriptors.ts` defines scaffold
  payload output as `z.object({}).catchall(z.unknown())`, so generated scaffold
  schemas prove only that `payload` is an object.

Concrete command checks confirm the same behavior:

| Command schema checked | What appears | What is missing |
| --- | --- | --- |
| `blood-test import-json --schema --format json` | `input` option and import result output | Blood-test import file body |
| `condition import-json --schema --format json` | `input` option and import result output | Condition upsert payload body |
| `encounter import-json --schema --format json` | `input` option and encounter import result output | Encounter bundle body |
| `event import-jsonl --schema --format json` | `input` and `apply` options plus import result output | Per-line JSONL event row body |
| `blood-test scaffold --schema --format json` | Open `payload` object | Exact analyte/result/reference-range contract |

## What We Are Doing Wrong

1. We are treating command schema and payload schema as the same thing. Incur's
   `--schema` answers "how do I call this command?", not "what JSON should I
   write into the file this command reads?"
2. We are treating scaffold output like a contract. It is useful as a starter
   example, but it is not complete enough for an agent to synthesize all valid
   nested data.
3. We hide some complex writable structures behind string options. For example,
   `blood-test save --result` validates each string as a
   `bloodTestResultSchema`, but Incur can only expose that option as an array of
   strings.
4. Payload knowledge is split across contracts, core types, usecase
   normalizers, scaffolds, hints, and tests. The agent-facing discovery path does
   not point at one canonical writable schema.
5. The group schema index points agents to leaf `--schema`, but leaf `--schema`
   is still only the command invocation schema for file-backed commands.

## Target Model

Keep the two schemas separate:

- Command schema: Incur-owned. Exposed by `--schema`. Covers args, options, env,
  and output.
- Payload schema: Murph-owned. Exposed by explicit `payload-schema` commands.
  Covers the JSON or JSONL body that a file-backed command reads.

Recommended command surface:

```text
vault-cli blood-test payload-schema --format json
vault-cli condition payload-schema --format json
vault-cli encounter payload-schema --format json
vault-cli event payload-schema --for import-json --kind measurement --format json
vault-cli event payload-schema --for import-jsonl --kind sleep_session --format json
```

Use noun-level `payload-schema` commands where the noun has one obvious file
payload. Use `event payload-schema --for ...` for event because `event
import-jsonl` is already a leaf command. Changing it into `event import-jsonl
payload-schema` would collide with the existing Incur command tree unless we
renamed or nested the current command, which is not worth the compatibility
cost.

The command output should be a small envelope:

```json
{
  "schemaVersion": "murph.payload-schema.v1",
  "command": "blood-test import-json",
  "mediaType": "application/json",
  "schemaName": "blood-test-import-payload",
  "schema": {},
  "examples": []
}
```

For JSONL, the envelope should be explicit that `schema` describes one line:

```json
{
  "schemaVersion": "murph.payload-schema.v1",
  "command": "event import-jsonl",
  "mediaType": "application/jsonl",
  "lineSchemaName": "event-import-jsonl-row",
  "schema": {},
  "examples": []
}
```

The `schema` field should be normal JSON Schema generated from the same Zod
schema used by validation. Do not maintain a second handwritten schema.

## Schema Ownership

Use the existing owner boundaries.

| Payload | Current source of truth | Migration target |
| --- | --- | --- |
| `condition import-json` | `conditionUpsertPayloadSchema` in `packages/contracts/src/shares.ts`; wired into `healthEntityDefinitions` | Add to `packages/contracts/src/schemas.ts` and generated artifacts, then expose through `condition payload-schema` |
| `blood-test import-json` | Scaffold in `health-entities.ts`, nested results in `bloodTestResultSchema`, usecase import in `explicit-health-family-services.ts` | Add one dedicated blood-test import payload Zod schema that composes `bloodTestResultSchema`, make import validation and `payload-schema` share it |
| `encounter import-json` | Manual normalizers in `packages/vault-usecases/src/usecases/encounter.ts`; core input types in `packages/core/src/history/types.ts` | Replace or wrap the manual body parser with a Zod schema for the encounter bundle, then expose the same schema through `encounter payload-schema` |
| `event import-jsonl` | JSONL parser in `event-record-mutations.ts`; public-kind gate in `packages/core/src/domains/events/drafts.ts`; batch validation in `buildPublicEventImportRecord` | Add public writable event draft schemas by kind and a no-explicit-id JSONL row variant, then expose through `event payload-schema --for import-jsonl --kind <kind>` |

Prefer `packages/contracts` for reusable public payload contracts that are part
of the CLI and agent surface. If a schema is truly internal and unstable, keep
it in the owning usecase package, but do not advertise it as an agent generation
contract until it is ready to be stable.

## Scaffold After Migration

Keep scaffold. It is still the fastest way for a human or agent to see a good
starter payload.

Change its role in discovery:

- `scaffold` returns an example payload.
- `payload-schema` returns the exact writable contract.
- `--llms-full` and scaffold hints point from file-backed imports to the matching
  `payload-schema` command.
- Scaffold outputs may include a non-authoritative `schemaCommand` or CTA, but
  the contract remains the payload-schema command.

Do not make scaffold output the only schema source. That would preserve the
current ambiguity.

## Migration Phases

### Phase 1: Add The Payload Schema Primitive

Add a shared CLI/usecase helper for payload-schema command outputs:

- `schemaVersion: "murph.payload-schema.v1"`
- `command`
- `mediaType`
- `schemaName` or `lineSchemaName`
- `schema`
- optional `examples`

Implement a `createPayloadSchemaCommand` helper in the same CLI command-factory
area that owns shared scaffold/import-json command shapes. It should only return
metadata and JSON Schema; it should not read a vault or mutate state.

Acceptance checks:

- `payload-schema --format json` returns plain JSON usable by agents.
- `payload-schema --schema --format json` still returns the command schema for
  the schema command itself, preserving Incur semantics.
- MCP exposes `payload-schema` as a normal tool with ordinary args/options.

### Phase 2: Convert Existing Contract-Backed Health Nouns

Start with nouns that already have strict Zod upsert payload schemas, beginning
with `condition`.

Work:

- Add the payload schema to `packages/contracts/src/schemas.ts`.
- Regenerate `packages/contracts/generated/*.schema.json`.
- Register `<noun> payload-schema`.
- Add `--llms-full` hints from `<noun> import-json` and `<noun> scaffold` to
  `<noun> payload-schema`.

Acceptance checks:

- The scaffold payload validates against the new payload schema.
- Invalid payloads fail through the same schema that `payload-schema` emits.
- Existing `import-json --input @file.json|-` commands remain compatible.

### Phase 3: Add High-Value Event-Backed Payloads

Handle `blood-test` next because agents need nested analyte/result/reference
range shapes.

Work:

- Add a blood-test import payload schema that composes `bloodTestResultSchema`.
- Reuse the schema in `upsertBloodTest` validation rather than only relying on
  generic object loading plus downstream mutation errors.
- Register `blood-test payload-schema`.
- Leave `blood-test save` as an ergonomic typed facade, but document that complex
  nested writes should use `import-json` plus `payload-schema`.

Acceptance checks:

- The payload schema exposes `results[]`, `referenceRange`, comparator, flags,
  analyte, numeric value, and text value rules.
- The schema rejects a result without both `value` and `textValue`.
- `blood-test scaffold` validates against the schema.

### Phase 4: Make Encounter A Real Payload Contract

Encounter currently has useful validation but much of it is hand-normalized in
the usecase. Convert that into an explicit schema before advertising it as
agent-writeable.

Work:

- Create an encounter bundle schema with `encounter`, optional `measurements`,
  optional `procedures`, and optional `tests`.
- Require stable `eventId` on the encounter and every child fact, matching the
  retry behavior documented in `docs/contracts/03-command-surface.md`.
- Compose existing shared schemas such as `bloodTestResultSchema`,
  `encounterDiagnosisSchema`, `eventRelationLinkSchema`, and `externalRefSchema`
  instead of copying nested definitions.
- Register `encounter payload-schema`.

Acceptance checks:

- Existing encounter invalid-payload tests still fail with equivalent messages.
- The scaffolded encounter bundle validates against the payload schema.
- A bundle missing a child `eventId` fails before core mutation.

### Phase 5: Add Event Payload Schemas By Kind

Generic event import is inherently kind-specific. Avoid one loose "event object"
schema that accepts anything.

Work:

- Define public writable draft schemas for the kinds in
  `PUBLIC_EVENT_WRITE_KIND_LIST`.
- Add an import-jsonl row variant that rejects explicit `id` and `eventId`.
- Decide whether `externalRef` is required for JSONL. The current batch
  reconciler is designed around `externalRef`, but the implementation should be
  checked and tightened deliberately rather than implied by docs alone.
- Register `event payload-schema --for import-json|import-jsonl --kind <kind>`.

Acceptance checks:

- JSONL row schemas reject explicit ids.
- The schema kind set matches the public-write kind gate.
- Invalid JSONL rows fail atomically before any write, preserving current import
  behavior.

### Phase 6: Update Discovery

After payload-schema commands exist, update discovery copy and command docs:

- `--llms-full` for file-backed import commands should say: "Generate the file
  body from `<noun> payload-schema`; use `<noun> scaffold` for an example."
- `scaffold` hints should describe scaffold as an example, not a full schema.
- The root/group schema index note should distinguish command schema from
  payload schema.
- `docs/contracts/03-command-surface.md` should list the implemented
  payload-schema grammar once it exists.

Do not overload Incur `--schema` with hidden Murph payload bodies. That would
make `--schema` mean different things for different commands and would be
surprising across CLI, skills, and MCP.

## Non-Goals

- Do not replace `import-json --input @file.json|-`. It is the right primitive
  for complex and bulk payloads.
- Do not force every nested object into command options. Shell flags are a poor
  fit for deep JSON, and Incur's strongest discovery path is command shape, not
  arbitrary file-body inference.
- Do not create a parallel CLI framework or patch Incur for Murph-only payload
  behavior.
- Do not publish loose schemas just to unblock discovery. A payload schema that
  accepts arbitrary objects is worse than a scaffold because it looks
  authoritative.

## Final Acceptance Matrix

| Surface | Required proof |
| --- | --- |
| `condition payload-schema` | Emits the exact condition import payload schema and validates current scaffold |
| `blood-test payload-schema` | Emits nested blood-test result rules and rejects invalid result objects |
| `encounter payload-schema` | Emits the encounter bundle schema with stable ids for every fact |
| `event payload-schema --for import-jsonl --kind <kind>` | Emits a per-line row schema, kind-gated to public writable events, with explicit ids rejected |
| `--schema` | Still reports only command args/options/env/output |
| `--llms-full` | Points agents to payload-schema for file bodies and scaffold for examples |
| MCP | Exposes payload-schema commands as ordinary tools and does not hide payload contracts behind `input: string` |
| Imports | Use the same Zod schemas that payload-schema emits |
| Compatibility | Existing `import-json`, `import-jsonl`, and scaffold commands continue to work |

