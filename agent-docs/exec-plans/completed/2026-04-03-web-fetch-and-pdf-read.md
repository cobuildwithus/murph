# Implement assistant web.fetch and plan web.pdf.read

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Add a production-usable assistant `web.fetch` tool that can fetch public webpages safely, extract readable content for the model, and stay aligned with Murph's existing assistant tool/runtime boundaries.
- Record the intended `web.pdf.read` design before implementation starts so the PDF boundary is explicit in-repo instead of being invented mid-patch.

## Success criteria

- `packages/assistant-core` exposes a new `web.fetch` tool in the default assistant catalog when the runtime can use outbound fetch.
- `web.fetch` validates input URLs, blocks loopback/private-network targets, follows only bounded safe redirects, applies explicit timeouts and byte caps, and returns normalized fetch metadata plus extracted content.
- HTML responses prefer main-content extraction and degrade cleanly to a simpler text/markdown path when full readability extraction fails.
- The returned content remains clearly treated as untrusted external context rather than canonical Murph truth.
- Durable docs cover the new runtime/tool surface and its trust-boundary rules.
- The plan file records the intended `web.pdf.read` shape, extraction strategy, and why it remains a separate tool from `web.fetch`.
- Required verification and required final audit pass, or any unrelated baseline failures are documented explicitly.

## Scope

- In scope:
- Add `web.fetch` to the assistant tool catalog and implement the supporting helper/module(s) inside `packages/assistant-core`.
- Add focused tests for URL validation/guarding, extraction behavior, and tool exposure.
- Update durable docs for architecture/security as needed for the new web-fetch boundary.
- Write the planned `web.pdf.read` design in this plan file before implementing `web.fetch`.

- Out of scope:
- Full browser automation, CDP, cookie/session-aware browsing, or JS-executing page control.
- Firecrawl or other third-party scraping fallback providers in this turn.
- Implementing `web.pdf.read` itself in this turn unless the task is explicitly expanded later.

## Constraints

- Preserve unrelated dirty-tree edits already in the worktree.
- Keep search/fetch results and fetched page content explicitly non-canonical and untrusted.
- Do not broaden the current assistant trust boundary into host-browser automation in the same change.
- Any dependency additions must update the committed lockfile, pass the repo dependency-policy checks, and be justified by the implementation need.
- Reuse Murph's existing assistant tool patterns and retry/timeout helpers where they already fit, rather than introducing a second tool framework.

## Risks and mitigations

1. Risk: A naive fetch implementation can SSRF local control planes or private infrastructure.
   Mitigation: Add a small dedicated web-fetch guard that validates scheme, hostname, DNS resolution, and redirect targets before any body is consumed.
2. Risk: HTML extraction can be noisy or brittle across arbitrary websites.
   Mitigation: Use Readability-style extraction first, then fall back to a bounded simpler HTML-to-markdown/text cleanup path.
3. Risk: Adding a browser tool now would enlarge the local trust boundary too much.
   Mitigation: Keep browser automation explicitly out of scope and document it as a separate future lane.
4. Risk: PDF extraction could pull this patch into parser-toolchain/runtime coupling.
   Mitigation: Keep `web.pdf.read` as a planned separate tool with its own extraction/runtime decision instead of overloading `web.fetch`.

## Tasks

1. Add the active plan and ledger entries, then record the `web.pdf.read` design before any `web.fetch` code changes start.
2. Implement a guarded outbound fetch helper suitable for assistant web tools, including timeout, redirect, and bounded-body behavior.
3. Implement `web.fetch` content extraction and normalization for HTML, plain text, and JSON responses.
4. Expose `web.fetch` through the assistant tool catalog with a clear tool description and schema.
5. Add focused tests for the guard, extraction behavior, and tool availability.
6. Update durable docs for the new trust boundary and runtime expectations.
7. Run dependency-policy checks if new packages are added, then run the required verification and final audit workflow.

## Decisions

- Follow the OpenClaw split in spirit, not by cloning its entire architecture:
  - `web.fetch` is a lightweight guarded HTTP tool.
  - Browser automation remains a separate future concern.
  - PDF extraction remains a separate future tool.
- Reuse Murph's existing assistant-core retry/timeout patterns where practical, but add a dedicated guarded web-fetch helper because the repo does not currently have an SSRF-safe outbound web helper.
- Prefer explicit Murph env/config defaults for `web.fetch` limits instead of silently inheriting `web.search` settings.
- Keep fetched content in normalized tool results with explicit metadata (`finalUrl`, `status`, `contentType`, `extractor`, `truncated`, `warnings`) so the assistant can reason about result quality and safety.

## Planned web.pdf.read design

- Tool name:
  - `web.pdf.read`

- Why separate from `web.fetch`:
  - PDF extraction has different failure modes, size/page constraints, and parsing dependencies than ordinary webpage fetches.
  - Keeping it separate avoids hidden MIME-based behavior changes inside `web.fetch` and keeps the model-facing contract clearer.

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

- Intended implementation approach:
  - Reuse the same guarded outbound fetch layer as `web.fetch`.
  - Require final content type or URL shape consistent with PDF.
  - Parse text with a library-based path in `assistant-core` rather than depending on the local parser CLI toolchain.
  - Enforce explicit byte/page/char limits and return warnings when truncation occurs.

- Intended dependency/runtime choice:
  - Prefer a library-based Node path such as `pdfjs-dist` for assistant-runtime portability.
  - Do not couple the assistant web tool to `pdftotext` or other machine-local parser executables by default.

- Intended non-goals:
  - OCR-heavy scanned-PDF recovery in v1.
  - Browser-rendered PDF viewer automation.
  - Automatic PDF parsing hidden behind `web.fetch`.

## Verification

- Required:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

- Additional required if dependencies change:
- `pnpm deps:guard`
- `pnpm deps:audit`
- `pnpm deps:ignored-builds`

- Focused:
- Assistant-core focused tests covering the guarded fetch helper, extraction logic, and `web.fetch` tool exposure.

## Outcome

- Added guarded assistant `web.fetch` with HTTP(S)-only URL validation, loopback/private-network blocking, bounded redirects, timeout and response-byte limits, readable-content extraction, and normalized tool results.
- Added focused CLI assistant-catalog tests covering tool exposure, HTML extraction, and private-host blocking.
- Updated durable architecture/security docs and this plan now records the intended `web.pdf.read` boundary without implementing it yet.

## Verification results

- Passed:
  - `corepack pnpm deps:guard`
  - `corepack pnpm deps:ignored-builds`
  - `corepack pnpm typecheck`
  - `corepack pnpm test`
  - `corepack pnpm test:coverage`
  - Focused: `corepack pnpm vitest run packages/cli/test/inbox-model-harness.test.ts --project cli-inbox-setup --coverage.enabled false`
- Failed for unrelated existing dependency-audit baseline:
  - `corepack pnpm deps:audit`
  - Current high-severity advisories were reported in transitive paths under `apps/web` Prisma dev tooling plus `@cobuild/review-gpt`'s MCP/Express chain (`hono`, `@hono/node-server`, `effect`, `path-to-regexp`, `lodash`).
- Required completion-workflow audit subagent pass was not run because this session's developer-tool policy only allows spawning agents when the user explicitly asks for sub-agents.
Completed: 2026-04-03
