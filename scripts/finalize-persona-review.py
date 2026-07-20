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
        raise RuntimeError(
            f"{path}: expected {expected} matches, found {actual}: {old[:120]!r}"
        )
    write(path, content.replace(old, new, expected))


def insert_before(path: str, marker: str, addition: str) -> None:
    content = read(path)
    if content.count(marker) != 1:
        raise RuntimeError(f"{path}: marker count is not one: {marker[:120]!r}")
    write(path, content.replace(marker, addition + marker, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    content = read(path)
    if marker in content:
        return
    write(path, content.rstrip() + "\n\n" + addition.strip() + "\n")


print("review: confine persona expression to interactive provider turns")
planning = "packages/assistant-engine/src/assistant/codex-turn/planning.ts"
replace_exact(
    planning,
    "const explicitAssistantPersona = privateInteractiveAudience",
    "const explicitAssistantPersona = privateInteractiveProviderTurn",
)
replace_exact(
    planning,
    "privateInteractiveAudience || groupAssistantStylePreferencesApply",
    "privateInteractiveProviderTurn || groupAssistantStylePreferencesApply",
)

print("review: align hosted preference projection tests")
hosted_preferences_test = "apps/web/test/hosted-onboarding-member-preferences.test.ts"
text = read(hosted_preferences_test)
pattern = re.compile(r"(?m)^(\s*)select: \{\n\1  assistantDetail: true,")
text, count = pattern.subn(
    lambda match: (
        f"{match.group(1)}select: {{\n"
        f"{match.group(1)}  assistantPersona: true,\n"
        f"{match.group(1)}  assistantDetail: true,"
    ),
    text,
)
if count != 2:
    raise RuntimeError(f"expected two hosted preference select assertions, found {count}")
write(hosted_preferences_test, text)
replace_exact(
    hosted_preferences_test,
    """    const member = {
      assistantDetail: null as number | null,
""",
    """    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
""",
    1,
)
replace_exact(
    hosted_preferences_test,
    """      preferences: {
        tone: "casual",
        voice: "warm",
      },
""",
    """      preferences: {
        persona: "navy-seal",
        tone: "casual",
        voice: "warm",
      },
""",
    1,
)
replace_exact(
    hosted_preferences_test,
    """    })).resolves.toMatchObject({
      assistantTone: "casual",
      assistantVoice: "warm",
""",
    """    })).resolves.toMatchObject({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "warm",
""",
    1,
)
replace_exact(
    hosted_preferences_test,
    """        preferences: {
          tone: "casual",
          voice: "warm",
        },
        userId: "member_123",
""",
    """        preferences: {
          persona: "navy-seal",
          tone: "casual",
          voice: "warm",
        },
        requestedFields: ["persona", "tone", "voice"],
        userId: "member_123",
""",
    1,
)
replace_exact(
    hosted_preferences_test,
    """    })).resolves.toMatchObject({
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: {
""",
    """    })).resolves.toMatchObject({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: {
""",
    1,
)

print("review: keep hosted personalization schema imports minimal")
replace_exact(
    "packages/hosted-execution/src/assistant-personalization.ts",
    "  defaultAssistantPersonalityScores,\n",
    "",
)

print("review: prove persona wake parsing and validation")
guards_test = "packages/hosted-execution/test/hosted-execution-contract-guards.test.ts"
insert_before(
    guards_test,
    "    const wake = parseHostedExecutionWake({\n",
    '''    expect(
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-persona",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-20T00:00:00.000Z",
        preferences: {
          persona: "navy-seal",
          tone: "casual",
          voice: "drill-sergeant",
        },
        requestedFields: ["persona", "tone", "voice"],
        userId: "user_guard",
      }),
    ).toEqual({
      eventId: "member-preferences-wake-persona",
      kind: "member.preferences.updated",
      occurredAt: "2026-07-20T00:00:00.000Z",
      preferences: {
        persona: "navy-seal",
        tone: "casual",
        voice: "drill-sergeant",
      },
      requestedFields: ["persona", "tone", "voice"],
      userId: "user_guard",
    });

''',
)
insert_before(
    guards_test,
    '''    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-invalid",
''',
    '''    expect(() =>
      parseHostedExecutionWake({
        eventId: "member-preferences-wake-invalid-persona",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-20T00:00:00.000Z",
        preferences: {
          persona: "celebrity-guru",
        },
        userId: "user_guard",
      }),
    ).toThrow(/persona/u);
''',
)

print("review: prove persona reaches the canonical vault")
runtime_test = "packages/assistant-runtime/test/hosted-runtime-context-coverage.test.ts"
replace_exact(
    runtime_test,
    """        preferences: {
          personality: {
            humor: 8,
          },
          tone: "formal",
          voice: "warm",
        },
      });
""",
    """        preferences: {
          persona: "navy-seal",
          personality: {
            humor: 8,
          },
          tone: "formal",
          voice: "warm",
        },
        requestedFields: ["persona", "tone", "voice"],
      });
""",
    1,
)
replace_exact(
    runtime_test,
    """      assert.deepEqual(first.assistant, {
        personality: {
          humor: 8,
        },
""",
    """      assert.deepEqual(first.assistant, {
        persona: "navy-seal",
        personality: {
          humor: 8,
        },
""",
    1,
)
replace_exact(
    runtime_test,
    """      assert.deepEqual(second.assistant, {
        personality: {
          detail: 7,
          humor: 8,
        },
""",
    """      assert.deepEqual(second.assistant, {
        persona: "navy-seal",
        personality: {
          detail: 7,
          humor: 8,
        },
""",
    1,
)

print("review: add resilient preview fallback")
voice_player = "apps/web/src/components/ui/voice-memo-player.tsx"
replace_exact(
    voice_player,
    """interface VoiceMemoPlayerProps {
  src: string;
""",
    """interface VoiceMemoPlayerProps {
  src: string;
  fallbackSrc?: string;
""",
)
replace_exact(
    voice_player,
    """  {
    src,
    caption,
""",
    """  {
    src,
    fallbackSrc,
    caption,
""",
)
replace_exact(
    voice_player,
    """  const [duration, setDuration] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
""",
    """  const [duration, setDuration] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    setResolvedSrc(src);
    setUnavailable(false);
  }, [fallbackSrc, src]);

  useEffect(() => {
""",
)
replace_exact(
    voice_player,
    """    const onError = () => {
      setUnavailable(true);
      setPlaying(false);
    };
""",
    """    const onError = () => {
      if (fallbackSrc && resolvedSrc !== fallbackSrc) {
        setResolvedSrc(fallbackSrc);
        setUnavailable(false);
        setPlaying(false);
        return;
      }
      setUnavailable(true);
      setPlaying(false);
    };
""",
)
replace_exact(
    voice_player,
    "  }, [exclusiveGroupId, src]);\n",
    "  }, [exclusiveGroupId, fallbackSrc, resolvedSrc]);\n",
)
replace_exact(voice_player, "        src={src}\n", "        src={resolvedSrc}\n")

picker = "apps/web/src/components/murph/murph-persona-picker.tsx"
replace_exact(
    picker,
    """      <VoiceMemoPlayer
        ref={playerRef}
        src={option.previewPath}
        preload="none"
        exclusiveGroupId="murph-persona-voice-preview"
        unavailableLabel="Preview pending"
""",
    """      <VoiceMemoPlayer
        ref={playerRef}
        src={option.previewPath}
        fallbackSrc={`/audio/murph-voices/${option.id}.mp3`}
        preload="metadata"
        exclusiveGroupId="murph-persona-voice-preview"
        unavailableLabel="Preview unavailable"
""",
)

write(
    "apps/web/test/voice-memo-player.test.tsx",
    '''import assert from "node:assert/strict";

import { act, createElement } from "react";
import { test } from "vitest";

import { renderClientComponent } from "./render-client-component";

test("VoiceMemoPlayer falls back once before marking a preview unavailable", async () => {
  const { VoiceMemoPlayer } = await import(
    "@/src/components/ui/voice-memo-player"
  );
  const rendered = await renderClientComponent(
    createElement(VoiceMemoPlayer, {
      fallbackSrc: "/audio/murph-voices/warm.mp3",
      src: "/audio/murph-personas/grandma/warm.mp3",
      unavailableLabel: "Preview unavailable",
    }),
    { requireButton: false },
  );

  try {
    const audio = rendered.container.querySelector("audio");
    assert.ok(audio);
    assert.equal(
      audio.getAttribute("src"),
      "/audio/murph-personas/grandma/warm.mp3",
    );

    await act(async () => {
      audio.dispatchEvent(new rendered.window.Event("error"));
    });
    assert.equal(audio.getAttribute("src"), "/audio/murph-voices/warm.mp3");
    assert.doesNotMatch(rendered.container.textContent ?? "", /Preview unavailable/u);

    await act(async () => {
      audio.dispatchEvent(new rendered.window.Event("error"));
    });
    assert.match(rendered.container.textContent ?? "", /Preview unavailable/u);
    assert.equal(
      rendered.container.querySelector<HTMLButtonElement>("button")?.disabled,
      true,
    );
  } finally {
    await rendered.cleanup();
  }
});
''',
)

write(
    "apps/web/test/murph-persona-picker.test.tsx",
    '''import assert from "node:assert/strict";

import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const componentMocks = vi.hoisted(() => ({
  playerPlay: vi.fn(),
  useIsMobile: vi.fn(() => false),
}));

vi.mock("@/src/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", { "data-dialog-open": "true" }, children) : null,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-dialog-content": "true" }, children),
  DialogDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DialogHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DialogTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/components/ui/drawer", () => ({
  Drawer: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? createElement("div", { "data-drawer-open": "true" }, children) : null,
  DrawerContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", { className, "data-drawer-content": "true" }, children),
  DrawerDescription: (props: HTMLAttributes<HTMLParagraphElement>) =>
    createElement("p", props),
  DrawerFooter: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerHeader: (props: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props),
  DrawerTitle: (props: HTMLAttributes<HTMLHeadingElement>) =>
    createElement("h2", props),
}));

vi.mock("@/src/components/ui/voice-memo-player", () => ({
  VoiceMemoPlayer: forwardRef<
    { play: () => void },
    { fallbackSrc?: string; preload?: string; src: string }
  >(function MockVoiceMemoPlayer({ fallbackSrc, preload, src }, ref) {
    useImperativeHandle(ref, () => ({ play: componentMocks.playerPlay }));
    return createElement("div", {
      "data-fallback-preview": fallbackSrc,
      "data-preload": preload,
      "data-voice-preview": src,
    });
  }),
}));

vi.mock("@/src/hooks/use-mobile", () => ({
  useIsMobile: componentMocks.useIsMobile,
}));

beforeEach(() => {
  componentMocks.playerPlay.mockReset();
  componentMocks.useIsMobile.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("MurphPersonaPicker saves persona, writing style, and voice atomically", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "drill-sergeant",
    }),
    init,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
    }),
    { requireButton: false },
  );

  try {
    await clickContaining(rendered, "Navy SEAL");
    await clickContaining(rendered, "Lowercase");

    const preview = rendered.container.querySelector(
      "[data-voice-preview='/audio/murph-personas/navy-seal/drill-sergeant.mp3']",
    );
    assert.ok(preview);
    assert.equal(
      preview.getAttribute("data-fallback-preview"),
      "/audio/murph-voices/drill-sergeant.mp3",
    );
    assert.equal(preview.getAttribute("data-preload"), "metadata");

    await clickContaining(rendered, "Continue with Navy SEAL");

    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls[0]?.[0], "/api/settings/assistant-style");
    assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), {
      persona: "navy-seal",
      tone: "casual",
      voice: "drill-sergeant",
    });
    assert.equal(onComplete.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

test("MurphPersonaPicker skips without writing preferences", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const onComplete = vi.fn();
  const onOpenChange = vi.fn();
  const { MurphPersonaPicker } = await import(
    "@/src/components/murph/murph-persona-picker"
  );
  const rendered = await renderClientComponent(
    createElement(MurphPersonaPicker, {
      onComplete,
      onOpenChange,
      open: true,
    }),
    { requireButton: false },
  );

  try {
    await clickContaining(rendered, "Skip");
    assert.equal(fetchMock.mock.calls.length, 0);
    assert.equal(onComplete.mock.calls.length, 1);
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally {
    await rendered.cleanup();
  }
});

async function clickContaining(
  rendered: Awaited<ReturnType<typeof renderClientComponent>>,
  text: string,
): Promise<void> {
  const button = Array.from(rendered.container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  assert.ok(button, `Missing button containing ${text}`);
  await act(async () => {
    button.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
  });
}
''',
)

print("review: remove the unused Settings persona projection")
member_preferences = "apps/web/src/lib/hosted-onboarding/member-preferences.ts"
replace_exact(
    member_preferences,
    "    assistantPersona: string | null;\n",
    "    assistantPersona?: string | null;\n",
)
settings_snapshot = "apps/web/src/lib/hosted-onboarding/account-settings-snapshot.ts"
replace_exact(settings_snapshot, "  AssistantPersonaId,\n", "")
replace_exact(settings_snapshot, "    persona: AssistantPersonaId | null;\n", "")
replace_exact(settings_snapshot, "    assistantPersona: true,\n", "")
replace_exact(
    settings_snapshot,
    """  const assistantPreferences = projectHostedMemberAssistantPreferences(member);
  const assistantModel = resolveHostedMemberAssistantModel(member);
""",
    """  const projectedAssistantPreferences = projectHostedMemberAssistantPreferences(member);
  const assistantPreferences = {
    personality: projectedAssistantPreferences.personality,
    tone: projectedAssistantPreferences.tone,
    voice: projectedAssistantPreferences.voice,
  };
  const assistantModel = resolveHostedMemberAssistantModel(member);
""",
)

print("review: document preview and deploy behavior")
append_once(
    "agent-docs/product-specs/murph-personas.md",
    "## Preview delivery",
    '''## Preview delivery

The picker asks for a persona-specific clip first at
`/audio/murph-personas/<persona-id>/<voice-id>.mp3`. Until generated clips are
published, the shared voice sample at `/audio/murph-voices/<voice-id>.mp3` is
the deterministic fallback. Both paths use the same canonical voice id; a
missing preview never blocks selection or saving. The generator writes only the
persona-specific assets and requires the existing ElevenLabs credentials.

## Deployment

Apply the additive database migration first. Deploy the contracts/runtime reader
next and converge warm hosted containers before Web can emit `persona` deltas;
then deploy Web. An older runtime rejects the new `requestedFields: ["persona"]`
member-preference event instead of consuming and losing it, so Web-first skew is
fail-closed but can block later preference mailbox work for that member. Verify
one onboarding save produces one consumed mailbox item and that
`bank/preferences.json` contains the selected persona, tone, and voice.''',
)
append_once(
    "agent-docs/exec-plans/active/2026-07-20-murph-personas.md",
    "## Review corrections",
    '''## Review corrections

- Missing persona preserves the pre-existing Classic Murph prompt and provider
  voice fallback byte-for-byte rather than materializing persona defaults.
- Persona and dial expression is confined to interactive provider turns;
  maintenance and notification decision turns do not inherit it.
- Onboarding uses the existing assistant-style mutation owner, one transaction,
  and one mailbox wake. The duplicate persona endpoint was removed.
- Persona-specific preview clips fall back to the existing canonical voice clips
  until generated assets are deployed.
- Runtime-first deployment is required because older runtime readers reject the
  new requested persona field and intentionally leave the mailbox item pending.''',
)

Path(__file__).unlink()
print("review: complete")
