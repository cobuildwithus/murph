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

## Local Codex rollout ownership

Live execution deliberately reuses the maintainer's authenticated ambient
Codex profile so the eval exercises the unchanged production adapter. Codex
therefore writes its ordinary non-ephemeral rollout files under the profile's
`sessions/` tree, outside the temporary vault and the eval run artifact. Those
files can contain the synthetic prompts plus system, model, reasoning, tool,
and provider activity. The eval does not include their paths or contents in
`run.json` or the ReviewGPT grading packet, and it does not delete them.

Codex owns that storage surface. Its location, permissions, and retention
follow the existing profile and filesystem umask; cold rollouts may be
compressed but are not expired by this eval. For a metadata-only before/after
inventory, count matching files without printing their paths:

```bash
find "${CODEX_HOME:-$HOME/.codex}/sessions" -type f \
  \( -name 'rollout-*.jsonl' -o -name 'rollout-*.jsonl.zst' \) \
  -print | wc -l
```

If an operator chooses to remove one, first resolve the exact synthetic session
through Codex's normal session surface, then use
`codex delete --force <EXACT_SESSION_UUID>`. Never glob-delete an ambient Codex
profile. The eval artifact intentionally omits that UUID.

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
  --target murph.current
```

The live target creates a mode-`0700` temporary case root containing one
synthetic vault, binds the provider working directory and `VAULT` environment
to that vault, and runs every scripted turn through `sendAssistantMessage`.
After the final root turn, it waits for the production background-work boundary
before recording bounded user-facing transcript, canonical counts, and
semantic booleans. It then stops the exact warm Codex process it started and
removes the case root. A failed background-work boundary fails the case while
the same stop-and-remove cleanup still runs. The runner is serial because the
production assistant process is shared inside one Node process.

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
stable cross-product of selected scenarios, targets, and trials in order.

```bash
pnpm eval:assistant -- list --program <module> [filters]
pnpm eval:assistant -- run --program <module> [filters] [options]
```

Targets must honor their `AbortSignal` and settle only after all case-owned
resources are released. On timeout or cancellation the runner waits for that
settlement before it starts another case or finalizes the run artifact.
