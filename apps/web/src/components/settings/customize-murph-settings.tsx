"use client";

import {
  assistantWebPersonalitySettingIds,
  assistantVoiceOptions,
  defaultAssistantPersonaId,
  resolveAssistantBasePersonaOption,
  resolveAssistantPersonaParts,
  type AssistantPersonaId,
  type AssistantWebPersonalitySettingId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { IdCard, MessageSquareText, Mic2, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import {
  MurphAssistantStylePicker,
  type MurphAssistantStylePreferences,
} from "@/src/components/murph/murph-assistant-style-picker";
import {
  MurphPersonaPicker,
  type MurphPersonaPreferences,
} from "@/src/components/murph/murph-persona-picker";
import { MurphContactCardPicker } from "@/src/components/murph/murph-contact-card-picker";
import { Button } from "@/src/components/ui/button";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import {
  MurphPersonalitySettingsDialog,
  resolveAssistantPersonalitySnapshotScores,
  type AssistantPersonalitySnapshot,
} from "./murph-personality-settings-dialog";
import { SettingsRow, SettingsRowList } from "./settings-row";
import { stripSettingsQueryParam } from "./hosted-settings-utils";

type CustomizeMurphAssistant = MurphAssistantStylePreferences & {
  persona?: AssistantPersonaId | null;
  personality?: AssistantPersonalitySnapshot | null;
};

const PERSONALITY_DIAL_SUMMARY_LABELS: Record<
  AssistantWebPersonalitySettingId,
  string
> = {
  humor: "Humor",
  push: "Push",
  detail: "Detail",
};

type AssistantStyleStep = "tone" | "voice";
const VOICE_QUERY_KEY = "voice";
const DEFAULT_ASSISTANT_STYLE: MurphAssistantStylePreferences = {
  tone: null,
  voice: null,
};

export function CustomizeMurphSettings({
  assistant,
  murphPhoneNumber,
  openVoiceLink = false,
  voiceTestContactOption = null,
}: {
  assistant?: CustomizeMurphAssistant | null;
  murphPhoneNumber?: string | null;
  openVoiceLink?: boolean;
  // Prefilled "hear the new voice" chat link; after a voice save we send the
  // member straight back into their Murph chat so the reply arrives in it.
  voiceTestContactOption?: MurphContactOption | null;
}) {
  const [style, setStyle] = useState<MurphAssistantStylePreferences>(
    assistant ?? DEFAULT_ASSISTANT_STYLE,
  );
  const [persona, setPersona] = useState<AssistantPersonaId>(
    assistant?.persona ?? defaultAssistantPersonaId,
  );
  const [personality, setPersonality] = useState<AssistantPersonalitySnapshot | null>(
    assistant?.personality ?? null,
  );
  const [pickerStep, setPickerStep] = useState<AssistantStyleStep | null>(
    openVoiceLink ? "voice" : null,
  );
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const [styleLevelsOpen, setStyleLevelsOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [previousOpenVoiceLink, setPreviousOpenVoiceLink] = useState(openVoiceLink);

  if (previousOpenVoiceLink !== openVoiceLink) {
    setPreviousOpenVoiceLink(openVoiceLink);
    if (openVoiceLink) {
      setPickerStep("voice");
    }
  }

  useEffect(() => {
    if (openVoiceLink) {
      stripSettingsQueryParam(VOICE_QUERY_KEY);
    }
  }, [openVoiceLink]);

  return (
    <>
      <SettingsRowList>
        <SettingsRow
          icon={<MessageSquareText className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="How Murph talks"
          value={style.tone ? formatAssistantTone(style.tone) : "Default"}
          empty={!style.tone}
          action={
            <Button type="button" size="default" variant="ghost" onClick={() => setPickerStep("tone")}>
              Customize
            </Button>
          }
        />
        <SettingsRow
          icon={<Sparkles className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Personality"
          value={formatPersonalitySummary(persona)}
          action={
            <Button type="button" size="default" variant="ghost" onClick={() => setPersonaPickerOpen(true)}>
              Customize
            </Button>
          }
        />
        <SettingsRow
          icon={<SlidersHorizontal className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Style levels"
          value={formatStyleLevelsSummary(personality, persona)}
          action={
            <Button type="button" size="default" variant="ghost" onClick={() => setStyleLevelsOpen(true)}>
              Customize
            </Button>
          }
        />
        <SettingsRow
          icon={<Mic2 className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Voice"
          value={style.voice ? formatAssistantVoice(style.voice) : "Classic Murph"}
          empty={!style.voice}
          action={
            <Button type="button" size="default" variant="ghost" onClick={() => setPickerStep("voice")}>
              Change
            </Button>
          }
        />
        {murphPhoneNumber ? (
          <SettingsRow
            icon={<IdCard className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
            label="Contact card"
            value="Murph's photo and name in your contacts"
            action={
              <Button type="button" size="default" variant="ghost" onClick={() => setContactPickerOpen(true)}>
                Customize
              </Button>
            }
          />
        ) : null}
      </SettingsRowList>
      {pickerStep ? (
        <MurphAssistantStylePicker
          singleStep
          initialStep={pickerStep}
          initialTone={style.tone}
          initialVoice={style.voice}
          // The successful save owns the chat handoff; closing the picker any
          // other way never navigates.
          onSaved={(preferences) => {
            setStyle(preferences);
            if (pickerStep === "voice" && voiceTestContactOption) {
              window.location.assign(voiceTestContactOption.href);
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              setPickerStep(null);
            }
          }}
          open
        />
      ) : null}
      {personaPickerOpen ? (
        <MurphPersonaPicker
          initialPersona={persona}
          initialTone={style.tone}
          initialVoice={style.voice}
          mode="personality"
          onSaved={(preferences) => setPersona(preferences.persona)}
          onOpenChange={(open) => {
            if (!open) {
              setPersonaPickerOpen(false);
            }
          }}
          open
          savePreference={saveAssistantPersonaOnlyPreference}
        />
      ) : null}
      {styleLevelsOpen ? (
        <MurphPersonalitySettingsDialog
          persona={persona}
          personality={personality}
          onSaved={setPersonality}
          onOpenChange={(open) => {
            if (!open) {
              setStyleLevelsOpen(false);
            }
          }}
          open
        />
      ) : null}
      {contactPickerOpen ? (
        <MurphContactCardPicker
          copy={{
            description:
              "iPhone only applies the photo when the card is saved as a new contact. Delete your current Murph contact first, then save this one fresh.",
            primaryAction: "Save new card",
            secondaryAction: "Close",
            title: "Pick a new look",
          }}
          onAddToContacts={() => setContactPickerOpen(false)}
          onOpenChange={setContactPickerOpen}
          onSkip={() => setContactPickerOpen(false)}
          open={contactPickerOpen}
        />
      ) : null}
    </>
  );
}

function formatPersonalitySummary(
  persona: AssistantPersonaId,
): string {
  const parts = resolveAssistantPersonaParts(persona);
  const main = resolveAssistantBasePersonaOption(parts.mainId).label;
  return parts.supportingId
    ? `${main} + ${resolveAssistantBasePersonaOption(parts.supportingId).label}`
    : main;
}

function formatStyleLevelsSummary(
  personality: AssistantPersonalitySnapshot | null,
  persona: AssistantPersonaId = defaultAssistantPersonaId,
): string {
  const scores = resolveAssistantPersonalitySnapshotScores(personality, persona);
  return assistantWebPersonalitySettingIds
    .map((id) => `${PERSONALITY_DIAL_SUMMARY_LABELS[id]} ${scores[id]}`)
    .join(" · ");
}

function formatAssistantTone(tone: AssistantTonePreference): string {
  return tone === "formal" ? "Formal" : "Casual";
}

function formatAssistantVoice(voice: AssistantVoiceOptionId): string {
  return assistantVoiceOptions.find((option) => option.id === voice)?.label ?? "Classic";
}

async function saveAssistantPersonaOnlyPreference(
  preferences: MurphPersonaPreferences,
): Promise<MurphPersonaPreferences> {
  const response = await fetch("/api/settings/assistant-style", {
    body: JSON.stringify({ persona: preferences.persona }),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Assistant persona save failed.");
  const body: unknown = await response.json();
  if (
    !body
    || typeof body !== "object"
    || Reflect.get(body, "assistantPersona") !== preferences.persona
  ) {
    throw new Error("Assistant persona save response was invalid.");
  }
  return preferences;
}
