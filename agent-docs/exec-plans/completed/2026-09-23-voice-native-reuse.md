# Reduce custom voice machinery through native Codex reuse

Status: completed
Created: 2026-09-23
Updated: 2026-09-24

## Goal

Reduce the native voice patch by restoring upstream event and delegation owners while preserving durable admission, call isolation, and provider accounting.

## Success criteria

- Public Live transcript fragments use the native normalized event stream without a duplicate raw-event queue.
- Public Live outputs reuse native message builders and chunking with translation only at the wire boundary.
- Public Live handoffs use the upstream transcript fallback and bounded, escaped delegation formatter.
- Corrections, speaker context, consecutive handoffs, managed input admission, tool-backed responses, and confirmed closure remain covered.
- The patch applies to the exact pinned Codex release; focused Rust tests/typechecking and relevant integration proof pass.

## Scope

- In scope: the public Live native patch, focused regression assertions, and its owning documentation.
- Out of scope: version upgrades, browser UX, billing policy, auth, durable mailbox admission, and final outbox speech selection.

## Constraints

- Preserve the upstream checkout and unrelated work; regenerate against the pinned revision in task-local scratch source.
- Preserve client-managed inputs so native tool work cannot precede durable acceptance.
- Preserve one-attempt public session creation and same-session close-only recovery.
- No production credentials or member data in verification.

## Risks and mitigations

1. Restoring upstream formatting includes transcript-derived input as well as the transcript field. Prove corrections and speaker attribution survive, XML is escaped, and both fields remain bounded.
2. Removing duplicate raw notifications could affect consumers. Inspect browser and runtime consumers; retain normalized events and authoritative usage/closure receipts.
3. Native compilation and helper prerequisites can obscure failures. Use the pinned helper and record exact checks and limits.

## Tasks

1. Trace native and Murph boundaries; choose deletions supported by existing upstream behavior.
2. Restore native handoff fallback/formatting, remove duplicate transcript/delegation raw event fan-out, and reuse native output builders and chunking.
3. Run focused native tests, Rust typechecking, source applicability, and composed voice proof.
4. Review the diff, complete the implementation plan, and prepare the scoped candidate for required PR CI and ReviewGPT gates.

## Decisions

- Keep the public wire codec: upstream internal and public Live protocols differ.
- Keep durable admission, usage accounting, and final speech delivery with their existing owners.
- Keep the no-retry endpoint wrapper: provider-wide retry changes would affect unrelated native paths.
- No public changelog is planned for this internal refactor with unchanged product behavior.

## Verification

- Passed: 179 Codex API unit tests; 18 native realtime core tests; 11 public Live app-server lifecycle tests; 10 Murph native voice/binding tests using the rebuilt CLI.
- Passed: native CLI build, Murph workspace build, engine typecheck, pinned upstream source/patch verification, complexity guard, and doc gardening.
- Cargo's macOS launch timed out during the first app-server initialization before voice. Direct launch of the exact compiled test executable from the native workspace passed all eleven cases; the isolated case passed with both baseline and candidate app-server binaries. Recorded in the task's Frog entry; no deadlines or production code changed for this limitation.
- Full first-provider requests were captured for identical direct and group control fixtures using actual baseline/candidate native voice input. Both differ only in the intended user-input text after generated identity/path normalization. GPT-6 Sol input measured with o200k_base (gpt-tokenizer 3.4.0): direct 31,923 to 31,937 tokens (+14, +0.04386%), 149,129 to 149,180 UTF-8 bytes (+51); group 28,764 to 28,778 tokens (+14, +0.04867%), 132,120 to 132,171 bytes (+51). Captures include instructions, messages, tool schemas, and provider-visible metadata; authorization is outside the body and prompt-cache keys are excluded. Generated IDs, timestamps, and local paths are normalized identically.
- The native formatter can add up to one bounded 4 KiB transcript-derived input field on long handoffs. The latest correction remains in the bounded transcript tail.
- Production native implementation: 42 added, 106 deleted lines (64 net removed), separately from tests, patch hunk metadata, and documentation.
- Passed: focused real-model journey on GPT-6 Sol with local subscription auth. The complete production assistant saved exactly one active weekly reminder, honored the corrected Thursday at 14:00 UTC, retained the correct Telegram destination, and produced a concise truthful confirmation. Reply review: Ready. Five earlier profile attempts were rejected by authentication or quota before model execution; no auth material was copied. This synthetic local journey does not use a hosted member usage ledger.
- Parent candidate review passed: complete diff, privacy, native owner reuse, unchanged admission/auth/usage/closure fences, removed event consumers, and explicit prompt-size tradeoff checked. No frontend presentation changed; no screenshot proof is needed.
- Implementation and local proof are complete. Required exact-head CI and ReviewGPT remain PR completion gates and will be recorded on the PR.
Completed: 2026-09-24
