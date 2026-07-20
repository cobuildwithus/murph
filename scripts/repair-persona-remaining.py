from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).write_text(content)


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    content = read(path)
    actual = content.count(old)
    if actual != expected:
        raise RuntimeError(f"{path}: expected {expected} matches, found {actual}: {old[:100]!r}")
    write(path, content.replace(old, new, expected))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    content = read(path)
    start_index = content.find(start)
    if start_index < 0:
        raise RuntimeError(f"{path}: start marker not found: {start!r}")
    end_index = content.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{path}: end marker not found: {end!r}")
    write(path, content[:start_index] + replacement + content[end_index:])


print("repair: planning compatibility")
planning = "packages/assistant-engine/src/assistant/codex-turn/planning.ts"
replace_exact(
    planning,
    """export interface AssistantTurnPreferenceContext {
  assistantPersona: AssistantPersonaId | null
  assistantPersonality: AssistantPersonalityPreferences | null
  assistantTone: AssistantTonePreference | null
  assistantVoice: string | null
}

const DEFAULT_ASSISTANT_TURN_PREFERENCE_CONTEXT: AssistantTurnPreferenceContext = {
  assistantPersona: null,
  assistantPersonality: null,
  assistantTone: null,
  assistantVoice: null,
}
""",
    """export interface AssistantTurnPreferenceContext {
  assistantPersona?: AssistantPersonaId | null
  assistantPersonality: AssistantPersonalityPreferences | null
  assistantTone: AssistantTonePreference | null
  assistantVoice: string | null
}

const DEFAULT_ASSISTANT_TURN_PREFERENCE_CONTEXT: AssistantTurnPreferenceContext = {
  assistantPersonality: null,
  assistantTone: null,
  assistantVoice: null,
}
""",
)
replace_between(
    planning,
    "  const effectiveAssistantStyle = resolveAssistantEffectiveStyle({\n",
    "  const diagnosticsPolicy = resolveAssistantDiagnosticsPolicy({\n",
    """  const explicitAssistantPersona = privateInteractiveAudience
    ? preferenceContext.assistantPersona ?? null
    : null
  const effectiveAssistantStyle = explicitAssistantPersona
    ? resolveAssistantEffectiveStyle({
        persona: explicitAssistantPersona,
        ...(preferenceContext.assistantTone
          ? { tone: preferenceContext.assistantTone }
          : {}),
        ...(preferenceContext.assistantVoice
          ? { voice: preferenceContext.assistantVoice }
          : {}),
        ...(preferenceContext.assistantPersonality
          ? { personality: preferenceContext.assistantPersonality }
          : {}),
      })
    : null
  const assistantTone = effectiveAssistantStyle?.tone
    ?? preferenceContext.assistantTone
  const assistantPersonality = effectiveAssistantStyle?.personality
    ?? preferenceContext.assistantPersonality
  const assistantVoice = preferenceContext.assistantVoice
    ?? effectiveAssistantStyle?.voice
    ?? null
""",
)
replace_exact(planning, "assistantTone: effectiveAssistantStyle.tone,", "assistantTone,", 2)
replace_exact(
    planning,
    """            assistantPersona: privateInteractiveAudience
              ? effectiveAssistantStyle.persona
              : null,
            assistantPersonality:
              privateInteractiveAudience || groupAssistantStylePreferencesApply
                ? effectiveAssistantStyle.personality
                : null,
""",
    """            assistantPersona: explicitAssistantPersona,
            assistantPersonality:
              privateInteractiveAudience || groupAssistantStylePreferencesApply
                ? assistantPersonality
                : null,
""",
)
replace_exact(
    planning,
    """        ? resolveAssistantVoiceOptionElevenLabsVoiceId(
            effectiveAssistantStyle.voice,
          )
""",
    """        ? resolveAssistantVoiceOptionElevenLabsVoiceId(assistantVoice)
""",
)
replace_exact(
    planning,
    """    return {
      assistantPersona: preferences.assistant?.persona ?? null,
      assistantPersonality: preferences.assistant?.personality ?? null,
      assistantTone: preferences.assistant?.tone ?? null,
      assistantVoice: preferences.assistant?.voice ?? null,
    }
  } catch {
    return {
      assistantPersona: null,
      assistantPersonality: null,
      assistantTone: null,
      assistantVoice: null,
    }
""",
    """    return {
      ...(preferences.assistant?.persona
        ? { assistantPersona: preferences.assistant.persona }
        : {}),
      assistantPersonality: preferences.assistant?.personality ?? null,
      assistantTone: preferences.assistant?.tone ?? null,
      assistantVoice: preferences.assistant?.voice ?? null,
    }
  } catch {
    return {
      assistantPersonality: null,
      assistantTone: null,
      assistantVoice: null,
    }
""",
)

print("repair: system prompt compatibility")
system_prompt = "packages/assistant-engine/src/assistant/system-prompt.ts"
replace_exact(
    system_prompt,
    """    conversationScope === "direct"
      ? buildAssistantPersonaPrompt(input.assistantPersona ?? null)
      : null,
""",
    """    conversationScope === "direct" && input.assistantPersona
      ? buildAssistantPersonaPrompt(input.assistantPersona)
      : null,
""",
)
replace_exact(
    system_prompt,
    """Behavioral baseline:
Support judgment and name uncertainty. Never moralize, shame, use purity language, or treat the body as a failing project. Be a partner rather than claiming authority over the user. Saved persona, tone, and personality settings may change expression and emphasis, never facts, evidence standards, safety, privacy, consent, authorization, or required warnings.`;
""",
    """Personality:
Calm, observant, direct, plainspoken. Defaults: Humor 3—deadpan; at most one earned beat when playful; no canned bits, laughing emojis, or user-directed jokes. Push 3—one small reversible step with visible choice. Detail 5—answer first, then useful context. Support judgment; name uncertainty. Never moralize, shame, use purity language, or treat the body as a failing project. Be a peer, not an authority: outside safety concerns, offer one better idea at most, then back an informed choice without veto or lecture.`;
""",
)
replace_exact(
    system_prompt,
    "- Push changes delivery, not authority, and above the gentlest levels it applies only to explicit user-chosen, low-risk, non-sensitive goals. Never pressure a reply, signup, sharing, spending, consent, health compliance, authorization, or irreversible action; never infer motive or alter notification/follow-up cadence.",
    "- Push changes delivery, not authority. Never shame, coerce, invent urgency, demand unsafe exertion, continue after the user asks to stop, pressure a reply or consent, or alter notification and follow-up cadence.",
)
replace_exact(
    system_prompt,
    "- Expression only; higher rules win. No Humor for emergencies, self-harm, serious health/medication decisions, grief/trauma/abuse/acute distress, or sensitive privacy/auth/billing/consent/irreversible actions. Push only explicit user-chosen low-risk, non-sensitive goals; never shame, coerce, invent urgency, demand unsafe exertion, or alter message cadence.",
    "- Expression only; higher rules win. No Humor for emergencies, self-harm, serious health or medication decisions, grief, trauma, abuse, acute distress, or sensitive privacy, authentication, billing, consent, or irreversible actions. Push never permits shame, coercion, invented urgency, unsafe exertion, persistence after a stop request, or altered message cadence.",
)

print("repair: catalog simplification")
catalog = "packages/contracts/src/assistant-personas.ts"
text = read(catalog)
text = text.replace("  defaultAssistantPersonalityScores,\n", "")
text = text.replace("  defaultAssistantTonePreference,\n", "")
text = text.replace("  defaultAssistantVoiceOptionId,\n", "")
text, count = re.subn(
    r'''export const assistantPersonaCategoryValues = \[
  "push",
  "reason",
  "ground",
  "relate",
\] as const;

export type AssistantPersonaCategory =
  \(typeof assistantPersonaCategoryValues\)\[number\];

''',
    "",
    text,
)
if count != 1:
    raise RuntimeError(f"catalog category header matches: {count}")
text = text.replace("  category: AssistantPersonaCategory;\n", "")
text, count = re.subn(
    r'^    category: "(?:push|reason|ground|relate)",\n',
    "",
    text,
    flags=re.MULTILINE,
)
if count != 16:
    raise RuntimeError(f"catalog category rows: {count}")
start = text.index("const assistantPersonaOptionById = new Map")
end = text.index("export function resolveAssistantEffectiveStyle", start)
replacement = '''const assistantPersonaOptionById = new Map<AssistantPersonaId, AssistantPersonaOption>(
  assistantPersonaOptions.map((option) => [option.id, option]),
);
const assistantVoiceOptionById = new Map(
  assistantVoiceOptions.map((option) => [option.id, option]),
);
const resolvedDefaultAssistantPersonaOption =
  assistantPersonaOptionById.get(defaultAssistantPersonaId);
if (!resolvedDefaultAssistantPersonaOption) {
  throw new TypeError("Classic Murph is missing from the persona catalog.");
}
export const defaultAssistantPersonaOption = resolvedDefaultAssistantPersonaOption;

export function resolveAssistantPersonaOption(
  value: string | null | undefined,
): AssistantPersonaOption {
  return isAssistantPersonaId(value)
    ? assistantPersonaOptionById.get(value) ?? defaultAssistantPersonaOption
    : defaultAssistantPersonaOption;
}

export function resolveAssistantPersonaRecommendedVoiceOptions(
  persona: string | null | undefined,
): AssistantVoiceOption[] {
  return resolveAssistantPersonaOption(persona).recommendedVoiceIds.map((voiceId) => {
    const option = assistantVoiceOptionById.get(voiceId);
    if (!option) {
      throw new TypeError(`Persona voice ${voiceId} is missing from the voice catalog.`);
    }
    return option;
  });
}

'''
write(catalog, text[:start] + replacement + text[end:])

print("repair: picker and style helper")
picker = "apps/web/src/components/murph/murph-persona-picker.tsx"
replace_exact(
    picker,
    """  assistantPersonaOptions,
  assistantVoiceOptions,
  resolveAssistantPersonaOption,
  type AssistantPersonaId,
""",
    """  assistantPersonaOptions,
  resolveAssistantPersonaOption,
  resolveAssistantPersonaRecommendedVoiceOptions,
  type AssistantPersonaId,
  type AssistantVoiceOption,
""",
)
replace_exact(
    picker,
    """  const voices = selected.recommendedVoiceIds.flatMap((voiceId) => {
    const option = assistantVoiceOptions.find((candidate) => candidate.id === voiceId);
    return option
      ? [{
          ...option,
          previewPath: `/audio/murph-personas/${selected.id}/${option.id}.mp3`,
        }]
      : [];
  });
""",
    """  const voices = resolveAssistantPersonaRecommendedVoiceOptions(selected.id).map(
    (option) => ({
      ...option,
      previewPath: `/audio/murph-personas/${selected.id}/${option.id}.mp3`,
    }),
  );
""",
)
replace_exact(
    picker,
    "option: (typeof assistantVoiceOptions)[number] & { previewPath: string };",
    "option: AssistantVoiceOption & { previewPath: string };",
)
replace_exact(
    picker,
    "Choose how Murph should show up. You can change or fine-tune this anytime.",
    "Choose how Murph should show up. You can fine-tune the writing style, voice, and personality later.",
    2,
)
replace_exact(
    picker,
    'fetch("/api/settings/assistant-persona", {',
    'fetch("/api/settings/assistant-style", {',
)
style_tool = "packages/assistant-engine/src/assistant-codex/dynamic-tools/assistant-style.ts"
replace_exact(style_tool, "? !isDefaultPersonalitySetting(setting, actual)", "? !isDefaultPersonalitySetting(actual)")
replace_exact(
    style_tool,
    """function isDefaultPersonalitySetting(
  setting: AssistantPersonalitySettingId,
  snapshot: HostedRuntimeAssistantPersonalitySettingSnapshot,
): boolean {
""",
    """function isDefaultPersonalitySetting(
  snapshot: HostedRuntimeAssistantPersonalitySettingSnapshot,
): boolean {
""",
)

print("repair: route tests")
route_test = "apps/web/test/settings-assistant-style-route.test.ts"
replace_exact(
    route_test,
    "mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({\n      assistantPersonality:",
    "mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({\n      assistantPersona: null,\n      assistantPersonality:",
    2,
)
replace_exact(
    route_test,
    "await expect(response.json()).resolves.toEqual({\n      assistantPersonality:",
    "await expect(response.json()).resolves.toEqual({\n      assistantPersona: null,\n      assistantPersonality:",
    3,
)
replace_exact(
    route_test,
    '  it("persists a sparse validated personality update", async () => {',
    '''  it("persists persona, writing style, and voice in one preference write", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValueOnce({
      assistantPersona: "navy-seal",
      assistantPersonality: { detail: 2, humor: 1, push: 10 },
      assistantTone: "formal",
      assistantVoice: "drill-sergeant",
      dispatch: { mailboxItemId: "mailbox_item_persona" },
      updated: true,
    });

    const response = await route.POST(jsonRequest({
      persona: "navy-seal",
      tone: "formal",
      voice: "drill-sergeant",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assistantPersona: "navy-seal",
      assistantTone: "formal",
      assistantVoice: "drill-sergeant",
      ok: true,
      runTriggered: true,
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      mailboxPayloadMode: "sparse_delta",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        persona: "navy-seal",
        tone: "formal",
        voice: "drill-sergeant",
      },
      prisma: { tx: true },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("persists a sparse validated personality update", async () => {''',
)
replace_exact(
    route_test,
    '  it("keeps personality writes closed until the causal runtime is enabled", async () => {',
    '''  it("keeps persona writes closed until sparse causal writes are enabled", async () => {
    vi.stubEnv("MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED", "0");
    const response = await route.POST(jsonRequest({
      persona: "navy-seal",
      tone: "formal",
      voice: "drill-sergeant",
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_PERSONA_ROLLOUT_PENDING",
        message: "Murph personas are temporarily unavailable during rollout.",
        retryable: true,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("keeps personality writes closed until the causal runtime is enabled", async () => {''',
)
replace_exact(
    route_test,
    '  it("rejects invalid tones before opening the persistence transaction", async () => {',
    '''  it("rejects invalid personas before opening the persistence transaction", async () => {
    const response = await route.POST(jsonRequest({ persona: "celebrity-guru" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_STYLE_INVALID_PERSONA",
        message: "Choose a valid Murph persona.",
        retryable: false,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown style fields instead of silently ignoring them", async () => {
    const response = await route.POST(jsonRequest({ tone: "formal", surprise: 5 }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ASSISTANT_STYLE_UNKNOWN_FIELD",
        message: "Assistant style request contains an unknown field.",
        retryable: false,
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid tones before opening the persistence transaction", async () => {''',
)
replace_exact(route_test, "Update personality separately from tone and voice.", "Update personality separately from persona, tone, and voice.")
replace_exact(route_test, "Choose a tone, voice, or personality setting before continuing.", "Choose a persona, tone, voice, or personality setting before continuing.")

print("repair: docs and cleanup")
replace_exact(
    "agent-docs/exec-plans/active/2026-07-20-murph-personas.md",
    "- Settings support for changing persona, voice, tone, and existing dials.",
    "- Existing Settings and conversation controls continue to fine-tune voice, tone, and dials; changing persona remains onboarding-only in this patch.",
)
replace_exact(
    "agent-docs/product-specs/murph-personas.md",
    "3. Classic Murph default when persona is absent or invalid",
    "3. the existing Classic Murph baseline when persona is absent; stale voice ids retain the existing provider fallback",
)
replace_exact(
    "agent-docs/product-specs/murph-personas.md",
    "Missing persona resolves to Classic Murph, while any existing tone, voice, Humor, Push, or Detail values remain explicit overrides. Existing members therefore keep their current behavior.",
    "Missing persona adds no persona or dial overlay to the prompt. The existing static Classic Murph baseline and any saved tone, voice, Humor, Push, or Detail overrides remain unchanged, so existing members keep their current behavior.",
)

Path("apps/web/app/api/settings/assistant-persona/route.ts").unlink()
Path("scripts/apply-murph-persona-integration.mjs.gz.b64").unlink()
for part in Path("scripts/persona-integration-parts").glob("*.b64"):
    part.unlink()
Path("scripts/persona-integration-parts").rmdir()
Path(".github/workflows/apply-murph-persona-integration.yml").unlink()
Path(__file__).unlink()
print("repair: complete")
