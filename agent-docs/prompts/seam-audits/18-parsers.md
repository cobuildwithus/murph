---
description: One-pass seam audit prompt for @murphai/parsers
---

# `@murphai/parsers`

## Scope

- `packages/parsers/src/{service.ts,shared.ts,index.ts}`
- `packages/parsers/src/toolchain/{config.ts,discover.ts}`
- `packages/parsers/src/registry/{registry.ts,policy.ts}`
- `packages/parsers/src/pipelines/{worker.ts,parse-attachment.ts,resolve-attachment-artifact.ts}`
- `packages/parsers/src/publish/writer.ts`
- `packages/parsers/src/adapters/{ffmpeg.ts,whisper-cpp.ts,text-file.ts,zxing-wasm.ts}`
- `packages/parsers/README.md`
- directly coupled `packages/parsers/test/**`

## Focus

- local-first toolchain discovery and parser registry behavior
- derived artifact publication under `derived/inbox/**` without canonical write creep
- temp/cache/raw separation, sanitized child-process envs, and deterministic parser result shaping

## Prompt

Review the `@murphai/parsers` seam using the scope above. Focus on concrete bugs in toolchain discovery, parser fallback ordering, derived artifact publication, parse-job completion semantics, and any path that could mix parser residue into canonical state or over-retain intermediate data. Return only evidence-backed findings from current code, prioritizing concrete regressions and behavior-preserving simplification targets that keep parser execution local-first, derived-only, and explicit. For each finding include `severity`, `file:line`, `issue`, `impact`, and `recommended fix`; list risk findings first, then simplification findings, and say explicitly if a category has no findings.
