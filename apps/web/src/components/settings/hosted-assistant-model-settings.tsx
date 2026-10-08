"use client";

import {
  HOSTED_ASSISTANT_ASTRA_MODEL,
  HOSTED_ASSISTANT_DEFAULT_MODEL,
  HOSTED_ASSISTANT_GPT_6_SOL_MODEL,
  HOSTED_ASSISTANT_GPT_61_SOL_MODEL,
  HOSTED_ASSISTANT_GPT_6_LUNA_MODEL,
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  isHostedAssistantProductModel,
  type HostedAssistantProductModel,
} from "@murphai/hosted-execution/assistant-model";
import { useState } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import { RadioGroup } from "@/src/components/ui/radio-group";
import { Spinner } from "@/src/components/ui/spinner";
import { cn } from "@/src/lib/utils";

import {
  ASSISTANT_MODEL_CHOICE_CARD_CLASSES,
  AssistantModelArtwork,
  type AssistantModelArtworkVariant,
} from "./assistant-model-artwork";
import { SettingsStatusLine } from "./connected-account-card";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";

const ASSISTANT_MODEL_SETTINGS_URL = "/api/settings/assistant-model";
const SOL_REQUIRES_EDGE_ERROR_CODE = "ASSISTANT_MODEL_SOL_REQUIRES_EDGE";

const MODEL_OPTIONS = [
  {
    artwork: "luna",
    description: "Fast health intelligence",
    model: HOSTED_ASSISTANT_GPT_6_LUNA_MODEL,
    name: "Luna",
    usage: "Low usage",
  },
  {
    artwork: "sol",
    description: "Deep health intelligence",
    model: HOSTED_ASSISTANT_GPT_61_SOL_MODEL,
    name: "Sol",
    usage: "Balanced usage",
  },
  {
    artwork: "astra",
    description: "Frontier health intelligence",
    model: HOSTED_ASSISTANT_ASTRA_MODEL,
    name: "Astra",
    usage: "Highest usage",
  },
] as const satisfies ReadonlyArray<{
  artwork: AssistantModelArtworkVariant;
  description: string;
  model: HostedAssistantProductModel;
  name: string;
  usage: string;
}>;

interface AssistantModelSettingsResponse {
  availableModels?: readonly HostedAssistantProductModel[];
  dormantSolPreference: boolean;
  model: HostedAssistantProductModel;
  ok: true;
  solAvailable: boolean;
  updated: boolean;
}

interface HostedAssistantModelSettingsProps {
  availableModels?: readonly HostedAssistantProductModel[];
  canUpgradeToEdge: boolean;
  configurationAvailable: boolean;
  expectedCurrentPlanCode?: "launch_group_monthly" | "launch_monthly";
  initialDormantSolPreference: boolean;
  initialModel: HostedAssistantProductModel;
  solAvailable: boolean;
}

export function HostedAssistantModelSettings(
  props: HostedAssistantModelSettingsProps,
) {
  return (
    <HostedAssistantModelSettingsForm
      key={`${props.availableModels?.join(",")}:${props.initialModel}:${String(props.initialDormantSolPreference)}:${String(props.solAvailable)}:${String(props.configurationAvailable)}:${String(props.canUpgradeToEdge)}`}
      {...props}
    />
  );
}

function HostedAssistantModelSettingsForm(
  props: HostedAssistantModelSettingsProps,
) {
  const [currentModel, setCurrentModel] = useState(props.initialModel);
  const [draftModel, setDraftModel] = useState(props.initialModel);
  const [dormantSolPreference, setDormantSolPreference] = useState(
    props.initialDormantSolPreference,
  );
  const [solAvailable, setSolAvailable] = useState(props.solAvailable);
  const [availableModels, setAvailableModels] = useState(props.availableModels);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    tone: "destructive" | "neutral";
  } | null>(null);
  const [saveAnnouncement, setSaveAnnouncement] = useState<string | null>(null);
  const controlsDisabled = isSaving || !props.configurationAvailable;
  const hasChanges = draftModel !== currentModel || dormantSolPreference;

  async function saveModel() {
    setIsSaving(true);
    setStatus(null);
    setSaveAnnouncement(null);
    try {
      const response = await requestHostedOnboardingJson<AssistantModelSettingsResponse>({
        method: "POST",
        payload: { model: draftModel },
        url: ASSISTANT_MODEL_SETTINGS_URL,
      });
      if (
        !isHostedAssistantProductModel(response.model)
        || typeof response.dormantSolPreference !== "boolean"
        || typeof response.solAvailable !== "boolean"
      ) {
        throw new Error("Assistant model response was invalid.");
      }
      setCurrentModel(response.model);
      setDraftModel(response.model);
      setDormantSolPreference(response.dormantSolPreference);
      setSolAvailable(response.solAvailable);
      setAvailableModels(response.availableModels);
      setSaveAnnouncement(
        response.dormantSolPreference
          ? `Saved. ${readProductModelName(response.model)} is active while Edge is paused; your previous model remains saved.`
          : `Saved. ${readProductModelName(response.model)} through OpenAI is your default.`,
      );
    } catch (error) {
      const solNoLongerAvailable = error instanceof HostedOnboardingApiError
        && error.code === SOL_REQUIRES_EDGE_ERROR_CODE;
      if (solNoLongerAvailable) {
        setDraftModel(currentModel);
        setSolAvailable(false);
      }
      setStatus({
        message: solNoLongerAvailable
          ? `Your Edge access changed. Murph will keep using ${readProductModelName(currentModel)}.`
          : "We couldn’t save this change. Try again.",
        tone: solNoLongerAvailable ? "neutral" : "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <form
        className="flex flex-col items-start gap-5"
        aria-busy={isSaving}
        onSubmit={(event) => {
          event.preventDefault();
          void saveModel();
        }}
      >
        <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
          Choose the intelligence behind your personal health assistant.
        </p>

        {!props.configurationAvailable ? (
          <p className="w-full rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
            Model choices are read-only until personal Murph access is active.
          </p>
        ) : null}

        {dormantSolPreference ? (
          <p className="w-full rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
            {`${readProductModelName(currentModel)} is active while Edge is paused. Your previous model is still saved and will return with Edge. Choose another model or save this default to replace it.`}
          </p>
        ) : null}

        <FieldSet
          className="w-full gap-3"
          disabled={controlsDisabled}
        >
          <FieldLegend className="sr-only">
            Default model
          </FieldLegend>
          <FieldDescription className="sr-only">
            Choose one model for new Murph replies.
          </FieldDescription>
          <RadioGroup
            className="grid gap-3 sm:grid-cols-2"
            disabled={controlsDisabled}
            value={draftModel}
            onValueChange={(value) => {
              if (!isHostedAssistantProductModel(value)) {
                return;
              }

              setDraftModel(value);
              setStatus(null);
            }}
          >
            {MODEL_OPTIONS.map((option) => {
              const selected = draftModel === option.model;
              const unavailable = option.model === HOSTED_ASSISTANT_ASTRA_MODEL
                && !availableModels?.includes(HOSTED_ASSISTANT_ASTRA_MODEL);
              const current = option.model === currentModel;
              const badge = readModelOptionBadge({
                current,
                dormantSolPreference,
                model: option.model,
                selected,
                unavailable,
              });

              return (
                <ChoiceCard
                  artwork={<AssistantModelArtwork variant={option.artwork} />}
                  badge={badge}
                  className={cn(
                    ASSISTANT_MODEL_CHOICE_CARD_CLASSES[option.artwork],
                    unavailable
                      && "[&_[data-slot=field-content]]:!opacity-100",
                  )}
                  description={option.description}
                  disabled={controlsDisabled || unavailable}
                  id={`assistant-model-${option.model}`}
                  key={option.model}
                  meta={
                    unavailable ? `${option.usage} · Edge required` : option.usage
                  }
                  title={option.name}
                  value={option.model}
                />
              );
            })}
          </RadioGroup>
        </FieldSet>

        {props.configurationAvailable
          && !solAvailable
          && props.canUpgradeToEdge ? (
          <div className="flex w-full justify-end px-1">
            <UpgradeToEdgeButton
              expectedCurrentPlanCode={
                props.expectedCurrentPlanCode ?? "launch_monthly"
              }
            >
              Upgrade to Edge
            </UpgradeToEdgeButton>
          </div>
        ) : null}

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-48">
          <Button
            disabled={controlsDisabled || !hasChanges}
            className="w-full sm:w-auto"
            type="submit"
          >
            {isSaving ? <Spinner aria-hidden="true" /> : null}
            {isSaving ? "Saving…" : "Save change"}
          </Button>
          {status ? (
            <SettingsStatusLine
              message={status.message}
              tone={status.tone}
            />
          ) : null}
          <SettingsStatusLine
            className="sr-only min-h-0"
            message={saveAnnouncement}
            tone="neutral"
          />
        </div>
      </form>
    </>
  );
}

function readModelOptionBadge(input: {
  current: boolean;
  dormantSolPreference: boolean;
  model: HostedAssistantProductModel;
  selected: boolean;
  unavailable: boolean;
}): React.ReactNode {
  if (input.current) {
    return (
      <ModelOptionBadge>
        {input.dormantSolPreference ? "Active" : "Default"}
      </ModelOptionBadge>
    );
  }

  if (input.selected) {
    return <ModelOptionBadge>Selected</ModelOptionBadge>;
  }

  if (input.unavailable) {
    return <ModelOptionBadge>Edge</ModelOptionBadge>;
  }

  if (input.model === HOSTED_ASSISTANT_DEFAULT_MODEL) {
    return <ModelOptionBadge>Recommended</ModelOptionBadge>;
  }

  return null;
}

function ModelOptionBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge
      variant="outline"
      className="h-5 rounded-md px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
    >
      {children}
    </Badge>
  );
}

function readProductModelName(model: HostedAssistantProductModel): string {
  if (model === HOSTED_ASSISTANT_ASTRA_MODEL) return "Astra";
  if (model === HOSTED_ASSISTANT_LUNA_MODEL || model === HOSTED_ASSISTANT_GPT_6_LUNA_MODEL) {
    return "Luna";
  }
  return model === HOSTED_ASSISTANT_SOL_MODEL || model === HOSTED_ASSISTANT_GPT_6_SOL_MODEL || model === HOSTED_ASSISTANT_GPT_61_SOL_MODEL ? "Sol" : "Murph";
}
