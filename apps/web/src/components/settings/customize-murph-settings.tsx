"use client";

import {
  assistantVoiceOptions,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { IdCard, MessageSquareText, Mic2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  MurphAssistantStylePicker,
  type MurphAssistantStylePreferences,
} from "@/src/components/murph/murph-assistant-style-picker";
import { MurphContactCardPicker } from "@/src/components/murph/murph-contact-card-picker";
import { Button } from "@/src/components/ui/button";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

import { SettingsRow, SettingsRowList } from "./settings-row";
import { stripSettingsQueryParam } from "./hosted-settings-utils";

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
  assistant?: MurphAssistantStylePreferences | null;
  murphPhoneNumber?: string | null;
  openVoiceLink?: boolean;
  // Prefilled "hear the new voice" chat link; after a voice save we send the
  // member straight back into their Murph chat so the reply arrives in it.
  voiceTestContactOption?: MurphContactOption | null;
}) {
  const [style, setStyle] = useState<MurphAssistantStylePreferences>(
    assistant ?? DEFAULT_ASSISTANT_STYLE,
  );
  const [pickerStep, setPickerStep] = useState<AssistantStyleStep | null>(
    openVoiceLink ? "voice" : null,
  );
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [previousOpenVoiceLink, setPreviousOpenVoiceLink] = useState(openVoiceLink);
  const voiceSavedRef = useRef(false);

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

  const closePicker = () => {
    setPickerStep(null);
    const voiceSaved = voiceSavedRef.current;
    voiceSavedRef.current = false;
    if (voiceSaved && voiceTestContactOption) {
      window.location.assign(voiceTestContactOption.href);
    }
  };

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
          onSaved={(preferences) => {
            setStyle(preferences);
            if (pickerStep === "voice") {
              voiceSavedRef.current = true;
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              closePicker();
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

function formatAssistantTone(tone: AssistantTonePreference): string {
  return tone === "formal" ? "Formal" : "Casual";
}

function formatAssistantVoice(voice: AssistantVoiceOptionId): string {
  return assistantVoiceOptions.find((option) => option.id === voice)?.label ?? "Classic";
}
