# Recap rejection diagnosis and silent regeneration recovery

## Outcome and invariant

Pair shows must explain correctable validation failures without exposing content in runtime logs. Preview and submission share preflight rules. Failed regeneration preserves the published recap and sends nothing; first-time fallback remains intact. Existing authority, immutable frozen selections, and media spending limits remain enforced.

## Owners and evidence

Contracts own story/schema rules; assistant-engine owns local files and tool diagnostics; Web owns current receipt/reference authority, publication and notification disposition; operator-config and Worker own music transport. Investigation found local draft schema exceptions collapsed to a generic identical-draft retry, and preview omitted selected-media checks required by submission. Production content is unavailable and must not be queried; supplied symptoms do not identify an exact failing rule.

## Work

1. Add closed rejection rules and corrective messages across schema, story, media preflight and tool boundaries; reuse validation before preview and freeze.
2. Trace music transport timeouts and preserve safe error/cause classes, elapsed bucket and response-header arrival; fix only reproduced defects.
3. Terminally skip exhausted show regenerations without replacing the existing publication or sending; permit a new request identity.
4. Exercise a synthetic seven-day pair with accented/multiword names, about twenty photos and three hundred mixed chat lines in three real Sol journeys. Record all rejection classes.
5. Focused contracts, assistant, Web/Postgres, operator-config and Worker proof; typecheck/lint; native Linux CI. Commit, push and open a template PR. No ReviewGPT, merge, deployment or production actions.

## Product UX

Outcome: useful shows recover before publication; failed replacements remain silent.
Reaches: pair show writers, current recap readers and recipients. Groups remain unchanged.
Proof: shared preview/write failures, media recovery, existing recap preservation, first-time fallback and later successful regeneration; three synthetic live journeys.

## Amendments and decisions

- Base: current origin/main; isolated authorized checkout, frozen install passed.
- No production access or real regeneration is permitted.
- Proven retry trap: malformed local drafts were caught by the generic write failure and told to retry unchanged. Schema failures now preserve `draft_json`, `draft_schema`, `superlative_shape`, `scene_cast`, `scene_prompt`, `song_line` or `media_receipt_missing` and corrective guidance. Uncertain post-freeze uploads still require the identical draft.
- Preview previously omitted selected receipt and cast-reference validation. It now uses Web's read-only `phase: preview` on the same writer route, including current references, and returns before selection persistence. Receipt/cast failures use `media_receipt_missing`, `media_slot`, `identity_reference`, `reference_revoked` and `media_integrity`. No new state owner or database schema.
- Returned player names are opaque: exact names can contain accents, spaces, pronoun-like words or emoji without triggering authored-copy bans. Unicode word matching and exact-name removal prevent false `chat_line_reuse`; surrounding prose still enforces `pronoun_ban`, `emoji_ban` and other existing copy rules. The guide now supplies exact quote/stat/receipt limits and repair instructions.
- Supplied production symptoms do not identify the exact rejected rule. No private data was queried or decrypted. The next failed tool emits only a closed rule code and per-rule counts to runtime issue details, never text, names, IDs or file paths.
- No short music timeout was reproduced: the SDK has a five-minute deadline covering body consumption and zero retries. Hosted provider fetch forwards its abort signal; ElevenLabs egress forwards the validated `/v1/music` request and body stream. A fake-clock test succeeds after 90-second headers plus a 30-second delayed body. Raw fetch cause survives the SDK wrapper; the Worker bridges only allowlisted error names/codes on transport failure. Ordinary upstream HTTP errors remain unchanged. Diagnostics distinguish header/body timeout, reset, abort, Worker limits, elapsed bucket and provider-header arrival; no claim that this identifies the historical production failure.
- Failed regeneration retires the existing generation receipt after an authoritative, locked recheck of exhaustion and non-acceptance. It never replaces the published recap or emits a line. Initial publication fallback remains intact, accepted replay remains idempotent and a new regeneration ID can succeed.

## Local proof

- Full `pnpm typecheck` passes, including workspace-boundary checks and Web/Worker/package consumers. Web lint and changed-TypeScript oxlint pass with existing warnings only; complexity guard passes with no new debt.
- Focused contracts (15), operator-config music (28), Worker/fixture (248), Web route/story policy (86), game-service Postgres (96), witness/retirement Postgres (70) pass. Assistant focused suites pass, including 192 latest tool/preview/notification/diagnostic cases plus workspace, media-file and generic failure suites. Hosted-execution: 956 pass, 8 existing opt-in skips.
- Postgres proof preserves existing show ciphertext, media rows and readable presentation for both attempts/deadline exhaustion; no acceptance is created for the failed request; a new ID accepts. Notification proof returns skip with no model or delivery call. Initial fallback and frozen same-draft retries remain covered.
- Three focused GPT-6.1 Sol subscription journeys on 7 days / 20 synthetic photos / 300 paginated mixed chat lines all pass (87.5s, 90.8s, 79.3s). Each generated two fixture images and one song in file mode, previewed/revised, accepted once, and queued one line/link without chat media. Each first encountered three `media_receipt_missing` schema issues during preview, corrected before freezing; none reached a rejected write. After clearer receipt field guidance, a fourth diagnostic run passed in 94.6s with no rejection. Artifacts: `audit-packages/recap-show-diagnose/run-{1,2,3}/`, including verification JSON, accepted presentation and preview PNGs. Synthetic media isolates authoring/recovery; this is not real ElevenLabs availability proof.
- Initial harness setup failures (missing adjacent code-mode host; fixture score with an extra task field) were corrected before the successful journeys. The original card-topic assertion was broadened to the fixture's actual evidenced moments after one accepted journey exposed that test-only mismatch. The test still validates card names, length, uniqueness and prohibited claims.
- Native Linux CI retains the production sandbox scenario, now asserting two read-only preview phases before prepare/accept, for successful and failed media. Local macOS results do not substitute for that gate.

## Deployment and completion

Web consumer first, then Worker/runner. The new runner emits `phase: preview`, so retain this Web consumer until all such runners have been rolled back. No migration, environment flag or iOS presentation change; existing show flags and media limits remain. Worker transport headers are optional to older runners. Ordinary turns add no awaited calls. ReviewGPT, production access, regeneration, merge and deployment are explicitly outside this task's authorization. PR CI results are reported by the completion owner after the candidate is pushed.
