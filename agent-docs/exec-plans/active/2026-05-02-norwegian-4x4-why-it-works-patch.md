# Norwegian 4x4 Why It Works Patch

## Goal

Land the supplied Norwegian 4x4 copy patch despite the downloaded patch file being truncated.

## Scope

- Apply only the visible patch intent:
  - Norwegian 4x4 `whyItWorks` copy.
  - Norwegian 4x4 mechanism-chain copy in the hosted experiment protocol tab.
- Preserve unrelated dirty work in the same files.
- Do not regenerate Health Commons catalog artifacts unless verification requires it.

## Files

- `packages/health-commons/content/protocols/norwegian-4x4/norwegian-4x4.md`
- `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx`

## Verification

- Focused readback of touched sections.
- `pnpm --filter @murphai/health-commons generate:check`
- Focused hosted-web test/typecheck or `bash scripts/workspace-verify.sh test:diff <touched files>` if truthful in the dirty tree.
