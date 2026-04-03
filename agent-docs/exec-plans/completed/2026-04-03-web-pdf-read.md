# Implement assistant web.pdf.read

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Add a production-usable assistant `web.pdf.read` tool that reads public PDFs safely through the same guarded outbound fetch boundary as `web.fetch`, while keeping PDF parsing explicit and separate from normal webpage fetching.

## Success criteria

- `packages/assistant-core` exposes `web.pdf.read` in the default assistant catalog when outbound web fetch is enabled.
- `web.pdf.read` reuses the existing public-HTTP guardrails from the web-fetch layer: HTTP(S)-only URLs, no credentials, no loopback/private-network access, bounded redirects, explicit timeout, and bounded response size.
- The tool verifies that the fetched resource is a PDF, extracts text with explicit page/character limits, and returns normalized metadata plus warnings/truncation state.
- `web.fetch` remains non-PDF by default and continues pointing callers to `web.pdf.read` for PDF content.
- Focused tests cover tool exposure, successful PDF extraction, and blocked/private-host behavior.
- Durable docs stay aligned with the explicit trust boundary that fetched PDF text is untrusted external context rather than canonical Murph data.

## Scope

- In scope:
- Add `web.pdf.read` to the assistant tool catalog.
- Add the assistant-core PDF extraction helper/module and the minimal shared helper refactor needed to reuse the guarded fetch boundary from `web.fetch`.
- Add focused tests for exposure, PDF extraction, and host blocking.
- Update durable docs only where the existing web-fetch trust-boundary wording needs to mention explicit PDF reading.

- Out of scope:
- OCR-heavy scanned-PDF recovery.
- Browser-rendered PDF viewer automation.
- Hidden MIME-based PDF parsing inside `web.fetch`.

## Constraints

- Preserve unrelated dirty-tree edits already in the worktree.
- Keep PDF content explicitly non-canonical and untrusted.
- Do not couple this assistant tool to local machine-only parser CLIs such as `pdftotext`.
- Any dependency addition must update the committed lockfile and pass the repo dependency-policy checks.

## Risks and mitigations

1. Risk: PDF parsing can silently consume too much memory or text.
   Mitigation: Enforce explicit response-byte, page, and character limits and return truncation warnings.
2. Risk: Mixing PDF handling into `web.fetch` would blur tool semantics.
   Mitigation: Keep `web.pdf.read` as a separate tool and leave `web.fetch` PDF handling as an explicit redirect/error path.
3. Risk: A separate PDF tool could accidentally bypass the guarded fetch path.
   Mitigation: Reuse the same URL validation, redirect, timeout, and private-host blocking logic from the existing web-fetch layer.

## Tasks

1. Refactor the existing `web-fetch` helper layer just enough to support reuse by `web.pdf.read`.
2. Add `web.pdf.read` text extraction with bounded page/character behavior.
3. Expose the tool in the assistant catalog.
4. Add focused tests and any minimal doc updates.
5. Run dependency-policy checks if a new dependency is added, then run the required verification and commit the scoped change.

## Decisions

- Keep the network guard and response fetch path shared with `web.fetch`, but keep PDF parsing in its own module and tool contract.
- Prefer a library-based Node path in assistant-core instead of machine-local `pdftotext`.
- Return normalized metadata similar to `web.fetch` so the model can reason about result quality consistently.
- Load `pdfjs-dist` lazily at runtime so Node can parse PDFs without forcing Cloudflare worker test/runtime bundles to evaluate browser-oriented PDF.js globals up front.

## Planned tool shape

- Tool name:
  - `web.pdf.read`

- Intended input shape:
  - `url: string`
  - `maxChars?: number`
  - `maxPages?: number`

- Intended output shape:
  - `url`
  - `finalUrl`
  - `status`
  - `contentType`
  - `pageCount`
  - `truncated`
  - `warnings`
  - `text`

## Verification

- Required:
- `corepack pnpm typecheck` ✅
- `corepack pnpm test` ✅
- `corepack pnpm test:coverage` ✅

- Additional required if dependencies change:
- `corepack pnpm deps:guard` ✅
- `corepack pnpm deps:audit` ⚠️ existing high advisories remain under `apps/web` Prisma dev tooling and `@cobuild/review-gpt`; no new audit exception added in this task
- `corepack pnpm deps:ignored-builds` ✅

- Focused:
- `corepack pnpm vitest run packages/cli/test/inbox-model-harness.test.ts --coverage.enabled false` ✅
- Assistant-focused harness coverage now includes `web.pdf.read` exposure, successful extraction, and blocked-loopback behavior.
Completed: 2026-04-03
