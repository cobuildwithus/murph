# Health Commons agent knowledge retrieval

Status: active
Created: 2026-08-07
Updated: 2026-08-10

## Goal

- Let Murph use source-backed Health Commons knowledge for ordinary health
  questions without requiring an experiment or protocol.
- Keep normal messages fast and retrieved context small.

## Root-cause evidence

- Health Commons already owns detailed claims, typed source findings, and safety
  boundaries.
- The assistant previously had no bounded read path for ordinary health answers.
- The first PR design exposed topic resolution, a separate focus, and packet
  merging to the model. That made the agent contract fragile and complex.

## Success criteria

- The Health Commons build produces one ignored, read-only SQLite FTS index from
  authored public content.
- One CLI command accepts the complete health question and returns sourced
  evidence plus matching safety.
- Murph does one lookup for substantive health advice and skips jokes,
  acknowledgements, logging, logistics, and non-health turns.
- The lookup never creates or suggests an experiment unless the member asks to
  try, test, track, or set one up.
- Missing, invalid, unknown, and ambiguous results fail safely without blocking
  an honest reply.

## Scope

- Health Commons generated search projection and read-only runtime reader.
- One bounded `vault-cli commons knowledge search` command.
- Assistant routing guidance for ordinary health questions.
- General photobiomodulation knowledge and removal of the duplicate red-light
  skill and device seed catalog.
- Exact public-artifact exception for the generated SQLite file.
- Focused generator, runtime, CLI, prompt, packaging, and release tests.
- Matching architecture, security, and Health Commons documentation.

## Constraints

- Authored Markdown and JSONL remain the only knowledge source of truth.
- SQLite is generated, read-only, and contains no user data.
- Use Node's built-in SQLite module. Add no package or external service.
- Return at most three evidence items, one safety item, and three ambiguity
  candidates.
- Do not load the full catalog or source files during an assistant turn.
- Do not add embeddings, a vector database, MCP search, or a network service.

## Tasks

1. [complete] Prove the assistant knowledge gap and existing sauna coverage.
2. [complete] Add the deterministic SQLite projection and bounded reader.
3. [complete] Simplify the public contract to one complete health question.
4. [complete] Keep topic resolution fail-closed and retrieval owner-scoped.
5. [complete] Remove the red-light skill and add general PBM Commons knowledge.
6. [complete] Add the exact release-guard exception for the public index.
7. [in progress] Run final verification, exact-head review, CI, and close the
   plan.

## Decisions

- Extend the existing Health Commons owner and `commons` CLI boundary.
- Index claim-sized rows instead of whole files.
- Resolve topics only from authored titles and aliases. Evidence text, source
  titles, citations, categories, and stems cannot admit a topic.
- Prefer contiguous phrases. Use conservative token overlap only as a fallback.
  Canonical titles beat aliases; longer phrases beat shorter phrases; equal
  owners stay ambiguous.
- Run separate evidence and safety SQL queries inside one public call.
- Keep source findings only when one authored target resolves through
  `related_protocol`, then `parent_family`, then `measures`.
- Exclude unsourced overviews, appraisals, reducer notes, page-wide safety, and
  full documents from assistant results.
- Keep one contentless FTS projection. Do not add another service, model,
  database, state owner, or query language.
- Permit `knowledge.sqlite` through the release guard only at its exact bundled
  public path. Every nearby database path remains blocked.
- Store stable PBM definition, evidence boundaries, dose math, and safety in
  Health Commons. Current official instructions or user input own mutable device
  specifications.
- Keep the Bryan Johnson sauna post as research input only. Stronger existing
  source pages already cover its useful claims.
- Preserve the wrong-topic, family-alias, typed-finding, qualifier, provenance,
  safety-only, and result-limit regressions found during prior review rounds.
- The earlier ReviewGPT loop reached its configured round cap. Do not start a
  new final round without explicit user approval.

## Verification

- `pnpm --dir packages/health-commons verify`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- Focused Health Commons, CLI schema/command, assistant prompt, Cloudflare
  packaging, and release artifact guard tests.
