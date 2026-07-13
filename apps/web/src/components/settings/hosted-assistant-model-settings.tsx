"use client";

import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  isHostedAssistantProductModel,
  type HostedAssistantProductModel,
} from "@murphai/hosted-execution/assistant-model";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";

import { SettingsStatusLine } from "./connected-account-card";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";

const ASSISTANT_MODEL_SETTINGS_URL = "/api/settings/assistant-model";
const SOL_REQUIRES_EDGE_ERROR_CODE = "ASSISTANT_MODEL_SOL_REQUIRES_EDGE";

const MODEL_OPTIONS = [
  {
    description:
      "Efficient for quick, everyday work. Uses less of your plan’s AI usage.",
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    name: "GPT-5.6 Luna",
  },
  {
    description: "Everyday check-ins, questions, and planning.",
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    name: "GPT-5.6 Terra",
  },
  {
    description: "Deeper research and harder tasks. Uses more of your Edge limit.",
    model: HOSTED_ASSISTANT_SOL_MODEL,
    name: "GPT-5.6 Sol",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  model: HostedAssistantProductModel;
  name: string;
}>;

interface AssistantModelSettingsResponse {
  dormantSolPreference: boolean;
  model: HostedAssistantProductModel;
  ok: true;
  solAvailable: boolean;
  updated: boolean;
}

interface HostedAssistantModelSettingsProps {
  canUpgradeToEdge: boolean;
  configurationAvailable: boolean;
  initialDormantSolPreference: boolean;
  initialModel: HostedAssistantProductModel;
  solAvailable: boolean;
}

export function HostedAssistantModelSettings(
  props: HostedAssistantModelSettingsProps,
) {
  return (
    <HostedAssistantModelSettingsForm
      key={`${props.initialModel}:${String(props.initialDormantSolPreference)}:${String(props.solAvailable)}:${String(props.configurationAvailable)}:${String(props.canUpgradeToEdge)}`}
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
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    tone: "destructive" | "neutral" | "success";
  } | null>(null);
  const availableModelOptions = solAvailable
    ? MODEL_OPTIONS
    : MODEL_OPTIONS.filter(
        (option) => option.model !== HOSTED_ASSISTANT_SOL_MODEL,
      );
  const controlsDisabled = isSaving || !props.configurationAvailable;
  const hasChanges = draftModel !== currentModel || dormantSolPreference;

  async function saveModel() {
    setIsSaving(true);
    setStatus(null);

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
      setStatus({
        message: `Default model updated to ${readModelName(response.model)}.`,
        tone: "success",
      });
    } catch (error) {
      const solNoLongerAvailable =
        error instanceof HostedOnboardingApiError &&
        error.code === SOL_REQUIRES_EDGE_ERROR_CODE;
      if (solNoLongerAvailable) {
        setDraftModel(currentModel);
        setSolAvailable(false);
      }
      setStatus({
        message: solNoLongerAvailable
          ? `Your Edge access changed. ${readModelName(currentModel)} is still your default.`
          : "Could not update your default model. Try again.",
        tone: solNoLongerAvailable ? "neutral" : "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col items-start gap-4"
      aria-busy={isSaving}
      onSubmit={(event) => {
        event.preventDefault();
        void saveModel();
      }}
    >
      <p className="text-sm text-pretty text-muted-foreground">
        Choose Murph’s default model. Changes apply to new work and can take a
        few minutes.
      </p>

      {!props.configurationAvailable ? (
        <p className="w-full rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
          Active personal Murph access is required to change assistant settings.
        </p>
      ) : null}

      {dormantSolPreference ? (
        <p className="w-full rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
          GPT-5.6 Terra is in use now. GPT-5.6 Sol remains saved and will resume
          if Edge access returns. Save Terra or Luna to replace that saved choice.
        </p>
      ) : null}

      <fieldset
        className="w-full overflow-hidden rounded-xl border border-border bg-background disabled:opacity-70"
        disabled={controlsDisabled}
      >
        <legend className="sr-only">Default model</legend>
        {availableModelOptions.map((option, index) => {
          const selected = draftModel === option.model;
          const nameId = `assistant-model-${option.model}-name`;
          const descriptionId = `assistant-model-${option.model}-description`;

          return (
            <label
              key={option.model}
              className={cn(
                "flex min-h-24 items-start gap-3 px-4 py-4 transition-colors",
                index > 0 && "border-t border-border",
                controlsDisabled
                  ? "cursor-default"
                  : "cursor-pointer hover:bg-muted/50",
                selected && "bg-primary/10",
                isSaving && "cursor-wait",
              )}
            >
              <input
                type="radio"
                name="assistant-model"
                value={option.model}
                checked={selected}
                aria-labelledby={nameId}
                aria-describedby={descriptionId}
                className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onChange={() => {
                  setDraftModel(option.model);
                  setStatus(null);
                }}
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    id={nameId}
                    className="font-serif text-lg font-semibold tracking-tight text-foreground"
                  >
                    {option.name}
                  </span>
                  {option.model === HOSTED_ASSISTANT_SOL_MODEL ? (
                    <Badge
                      variant="outline"
                      className="h-5 rounded-md px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      Edge
                    </Badge>
                  ) : null}
                </span>
                <span
                  id={descriptionId}
                  className="mt-0.5 block max-w-2xl text-sm text-pretty text-muted-foreground"
                >
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {props.configurationAvailable && !solAvailable ? (
        <div className="flex w-full flex-col items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-pretty text-muted-foreground">
            GPT-5.6 Sol is available with an active Edge plan.
          </p>
          {props.canUpgradeToEdge ? (
            <UpgradeToEdgeButton>Upgrade to Edge</UpgradeToEdgeButton>
          ) : null}
        </div>
      ) : null}

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-48">
        <Button
          type="submit"
          disabled={controlsDisabled || !hasChanges}
          className="w-full sm:w-auto"
        >
          {isSaving ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : null}
          {isSaving ? "Saving…" : "Save model"}
        </Button>
        <SettingsStatusLine
          message={status?.message ?? null}
          tone={status?.tone ?? "neutral"}
          className="sm:whitespace-nowrap"
        />
      </div>
    </form>
  );
}

function readModelName(model: HostedAssistantProductModel): string {
  if (model === HOSTED_ASSISTANT_LUNA_MODEL) {
    return "GPT-5.6 Luna";
  }

  return model === HOSTED_ASSISTANT_SOL_MODEL
    ? "GPT-5.6 Sol"
    : "GPT-5.6 Terra";
}
