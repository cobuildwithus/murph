# Reaction ambiguity and latency proof

Status: completed
Created: 2026-10-02
Updated: 2026-10-02

## Outcome and invariant

Keep clear acknowledgments quiet, interpret ambiguous reactions, and avoid a
redundant model round-trip for reactions that necessarily require interpretation.
Existing exact-target admission, consent, billing, cancellation, and root-thread
continuity remain authoritative. No Codex CLI source changes.

## Evidence and owner

The production reaction classifier owns the bounded gate. A 26-case local Luna
baseline reproduced two false quiet decisions: laughter at failed work and an
unidentified reaction. All calls were metered with no fallback. Median gate time
was 3028 ms, p95 4487 ms, maximum 5904 ms, including local cold process startup.
The existing live proof previously allowed error escalation to count as semantic
success; the expanded proof now rejects all classifier fallbacks.

## Smallest correction

- Clarify ambiguous laughter and unknown reactions in the existing prompt.
- Escalate only exact recognized question, negative, and unidentified reaction
  forms without a provider call; never add a deterministic quiet decision.
- Reduce the existing deadline from twenty to eight seconds, preserving normal
  interpretation on timeout. Successful local baseline calls fit inside this
  budget; actual network tails remain variable.
- Keep priority service and low reasoning, the lowest supported Luna level in
  the local model catalog. No new transport, cache, process pool, state, or tool.

## Native input correction

Actual pinned CLI capture exposed collaboration tools despite disabled feature
flags: model metadata can select multi-agent v2 unless `agents.enabled` is false.
Detached asks now explicitly disable agents and goals. Classifier and disclosure
review turns select no native environment, removing shell, patch, and image tools.
Generic native wrappers, input, and clock helpers remain; no CLI source is edited.
The native regression captures exact base classifier and helper sources separately.

## Product proof

Effort: Patch. Clear receipts, encouragement, jokes, quoted/rhetorical questions
stay quiet. Answers, proposals, multiple/negative questions, disagreement,
sarcasm, failures, unknown emoji, translated questions and injection attempts
continue to interpretation. The full production journey verifies quiet, direct
question escalation, and ambiguous laughter with no unauthorized writes.

## Verification

- Initial deterministic reaction tests: 8 passed; engine typecheck passed.
- Baseline local subscription: 26 Luna calls; 24 correct, 2 reproduced misses.
- Candidate deterministic reaction and admitted-turn suites: 65 passed.
- Final local subscription classifier: 26/26 correct, 21 metered Luna calls,
  five zero-call deterministic escalations, no fallbacks. Luna-only median
  2771 ms, p95 3035 ms; maximum 3760 ms. Synthetic all-case median 2746 ms.
- One earlier candidate run hit the eight-second deadline and escalated safely;
  it was rejected as semantic proof. No provider failure counts as a passing
  ambiguity test.
- Full production turn: clear appreciation stays silent after one Luna request;
  question-mark clarification gets one Sol request and a correct explanation;
  ambiguous laughter takes Luna then Sol, whose final interpretation is silence.
  No canonical writes. All three journeys Ready; escalation is not forced speech.
- Engine typecheck, complexity guard (max 16 to 17, no threshold-20 hotspots),
  and content-only changelog render proof (10 tests) pass.
- Native complete input: Luna heart request 26708 to 12244 bytes (-54.16%);
  explicit question 26711 bytes/one request to no request. Exact base and helper,
  CLI 0.160.0; only nondeterministic prompt-cache key excluded. Exact tokenizer
  unavailable, so this is neither a token count nor a billed-cost claim.
- Ordinary Sol private/group complete inputs remain 167242/143179 bytes.
- Native tools regression passes; 82 focused unit tests pass after the correction.
- Post-correction local subscription: 26/26 correct, 21 Luna calls, no fallbacks;
  Luna-only median 2860 ms, p95 3895 ms, max 5839 ms.
  Metered total 99424 tokens across 21 calls (99081 input, 343 output).
  The three full production journeys also pass with no canonical writes.
- Final parent review, typecheck, native capture, docs and complexity pass;
  max complexity remains 20 for Assistant Ask and 17 for the classifier.
  Full-turn clarification is concise and truthful; appreciation and the ambiguous
  failure remain quiet after the expected one and two requests respectively.
- External review and exact-head CI belong to the follow-up PR completion gate.

## Risks

A live pass is sampled model evidence, not a universal guarantee. No exact
production delivery latency is claimed. The shorter deadline may cause more
normal assistant fallbacks during provider slowness, preserving accepted input.
Completed: 2026-10-02
