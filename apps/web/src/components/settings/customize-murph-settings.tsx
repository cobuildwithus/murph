"use client";

import {
  assistantWebPersonalitySettingIds,
  assistantVoiceOptions,
  resolveAssistantEffectiveStyle,
  type AssistantWebPersonalitySettingId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { IdCard, MessageSquareText, Mic2, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import {
  MurphAssistantStylePicker,
  type MurphAssistantStylePreferences,
} from "@/src/components/murph/murph-assistant-style-picker";
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
  const [personality, setPersonality] = useState<AssistantPersonalitySnapshot | null>(
    assistant?.personality ?? null,
  );
  const [pickerStep, setPickerStep] = useState<AssistantStyleStep | null>(
    openVoiceLink ? "voice" : null,
  );
  const [styleLevelsOpen, setStyleLevelsOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [previousOpenVoiceLink, setPreviousOpenVoiceLink] = useState(openVoiceLink);
  const effectiveStyle = resolveAssistantEffectiveStyle({
    ...(style.tone ? { tone: style.tone } : {}),
    ...(style.voice ? { voice: style.voice } : {}),
  });

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
          value={formatAssistantToneSummary(effectiveStyle.tone, style.tone !== null)}
          action={
            <Button type="button" size="default" variant="ghost" onClick={() => setPickerStep("tone")}>
              Customize
            </Button>
          }
        />
        <SettingsRow
          icon={<SlidersHorizontal className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Style levels"
          value={formatStyleLevelsSummary(personality)}
          action={
            <Button type="button" size="default" variant="ghost" onClick={() => setStyleLevelsOpen(true)}>
              Customize
            </Button>
          }
        />
        <SettingsRow
          icon={<Mic2 className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Voice"
          value={formatAssistantVoiceSummary(effectiveStyle.voice, style.voice !== null)}
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
          initialTone={effectiveStyle.tone}
          initialVoice={effectiveStyle.voice}
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
      {styleLevelsOpen ? (
        <MurphPersonalitySettingsDialog
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

function formatStyleLevelsSummary(
  personality: AssistantPersonalitySnapshot | null,
): string {
  const scores = resolveAssistantPersonalitySnapshotScores(personality);
  return assistantWebPersonalitySettingIds
    .map((id) => `${PERSONALITY_DIAL_SUMMARY_LABELS[id]} ${scores[id]}`)
    .join(" · ");
}

function formatAssistantTone(tone: AssistantTonePreference): string {
  return tone === "formal" ? "Formal" : "Casual";
}

function formatAssistantToneSummary(
  tone: AssistantTonePreference,
  custom: boolean,
): string {
  return `${formatAssistantTone(tone)} · ${custom ? "Custom" : "Default"}`;
}

function formatAssistantVoice(voice: AssistantVoiceOptionId): string {
  return assistantVoiceOptions.find((option) => option.id === voice)?.label ?? "Classic";
}

function formatAssistantVoiceSummary(
  voice: AssistantVoiceOptionId,
  custom: boolean,
): string {
  return `${formatAssistantVoice(voice)} · ${custom ? "Custom" : "Default"}`;
}
