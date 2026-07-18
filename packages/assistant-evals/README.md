# `@murphai/assistant-evals`

Repository-private assistant evaluation tooling. It keeps Murph's product
contracts in the repository while reusing the production assistant service for
execution.

The package has two deliberately small layers:

- provider-neutral scenario, target, run-result, timeout, and atomic artifact
  primitives; and
- one concrete onboarding program made of synthetic scripted episodes against
  the current Murph assistant.

It does not own onboarding policy, product state, a user-simulator service, a
second assistant lifecycle, or a model-grader framework. Production packages
must not import this package.

## Onboarding suites

List the available scenarios:

```bash
pnpm eval:onboarding:list
```

Run the critical smoke suite:

```bash
pnpm build:test-runtime:prepared
pnpm eval:onboarding
```

Run the larger suite explicitly:

```bash
pnpm eval:assistant -- run \
  --program packages/assistant-evals/programs/onboarding.program.ts \
  --suite onboarding-full \
  --target murph.current \
  --concurrency 1
```

The live target creates a mode-`0700` temporary synthetic vault for each case,
binds the provider working directory and `VAULT` environment to that vault,
runs every scripted turn through `sendAssistantMessage`, records only bounded
user-facing transcript and canonical state counts, stops the exact warm Codex
process it started, and removes the vault before the case settles. Keep this
target at concurrency 1 because the production assistant process is shared
inside one Node process.

The CLI writes an atomic mode-`0600` snapshot to the ignored path:

```text
.artifacts/assistant-evals/<run-id>/run.json
```

A zero exit means the selected episodes executed and their artifacts were
written. Semantic pass/fail belongs to the independent grader below; each
episode also includes deterministic state checks that the grader treats as
hard gates.

## Grade with GPT Pro through ReviewGPT

Use one aggregate grading call per run. `--no-zip` keeps the repository out of
the grading packet; only the authored rubric, authoritative onboarding spec,
and synthetic run artifact are sent.

```bash
pnpm review:gpt \
  --model gpt-5.6-sol \
  --thinking current \
  --no-zip \
  --prompt-file packages/assistant-evals/prompts/onboarding-grader.md \
  --prompt-file agent-docs/product-specs/murph-onboarding.md \
  --prompt-file .artifacts/assistant-evals/<run-id>/run.json \
  --wait \
  --wait-timeout 120m \
  --response-file .artifacts/assistant-evals/<run-id>/gpt-pro-grade.md
```

ReviewGPT writes the grade beside the run evidence and, when model
metadata is available, a model-verification sidecar. This evaluation grade is
separate from the required ReviewGPT pull-request gate.

## Generic CLI

Programs default-export `defineEvalProgram(...)`. The runner executes the
stable cross-product of selected scenarios, targets, and trials; results remain
ordered even when a non-live program opts into bounded concurrency.

```bash
pnpm eval:assistant -- list --program <module> [filters]
pnpm eval:assistant -- run --program <module> [filters] [options]
```

Targets must honor their `AbortSignal` and settle only after all case-owned
resources are released. On timeout or cancellation the runner waits for that
settlement before it frees the worker slot or finalizes the run artifact.
