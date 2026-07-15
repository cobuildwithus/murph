"use client";

import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
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

import { SettingsStatusLine } from "./connected-account-card";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";

const ASSISTANT_MODEL_SETTINGS_URL = "/api/settings/assistant-model";
const SOL_REQUIRES_EDGE_ERROR_CODE = "ASSISTANT_MODEL_SOL_REQUIRES_EDGE";

const MODEL_OPTIONS = [
  {
    description: "Quick support for check-ins, simple questions, and routine tasks.",
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    name: "Luna",
    usage: "AI usage · Low",
  },
  {
    description:
      "A balanced choice for most questions, planning, and everyday health decisions.",
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    name: "Terra",
    usage: "AI usage · Balanced",
  },
  {
    description:
      "More depth for research, complex decisions, and demanding tasks.",
    model: HOSTED_ASSISTANT_SOL_MODEL,
    name: "Sol",
    usage: "AI usage · High",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  model: HostedAssistantProductModel;
  name: string;
  usage: string;
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
        message: `${readModelName(response.model)} is now Murph’s default.`,
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
          ? `Your Edge access changed. Murph will keep using ${readModelName(currentModel)}.`
          : "We couldn’t save this change. Try again.",
        tone: solNoLongerAvailable ? "neutral" : "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col items-start gap-5"
      aria-busy={isSaving}
      onSubmit={(event) => {
        event.preventDefault();
        void saveModel();
      }}
    >
      <div className="flex max-w-2xl flex-col gap-1">
        <p className="text-sm text-pretty text-muted-foreground">
          Pick Murph’s starting model. You can switch for a specific task in
          conversation.
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          Changes begin with the next reply and may take a few minutes.
        </p>
      </div>

      {!props.configurationAvailable ? (
        <p className="w-full rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
          Model choices are read-only until personal Murph access is active.
        </p>
      ) : null}

      {dormantSolPreference ? (
        <p className="w-full rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
          Terra is active while Edge is paused. Sol is still saved and will
          return with Edge. Choose Luna or save Terra to replace it.
        </p>
      ) : null}

      <FieldSet
        className="w-full gap-3"
        disabled={controlsDisabled}
      >
        <FieldLegend className="sr-only">Default model</FieldLegend>
        <FieldDescription className="sr-only">
          Choose one model for new Murph replies.
        </FieldDescription>
        <RadioGroup
          className="grid gap-3 lg:grid-cols-3"
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
            const unavailable =
              option.model === HOSTED_ASSISTANT_SOL_MODEL && !solAvailable;
            const current = option.model === currentModel;
            const badge = readModelOptionBadge({
              current,
              model: option.model,
              selected,
              unavailable,
            });

            return (
              <ChoiceCard
                badge={badge}
                description={option.description}
                disabled={controlsDisabled || unavailable}
                id={`assistant-model-${option.model}`}
                key={option.model}
                meta={
                  unavailable
                    ? `${option.usage} · Edge required`
                    : option.usage
                }
                title={
                  <span className="flex items-baseline gap-2">
                    <span>{option.name}</span>
                    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      GPT-5.6
                    </span>
                  </span>
                }
                value={option.model}
              />
            );
          })}
        </RadioGroup>
      </FieldSet>

      {props.configurationAvailable && !solAvailable ? (
        <div className="flex w-full flex-col items-start gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-pretty text-muted-foreground">
            Sol requires an active Edge plan.
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
          {isSaving ? <Spinner aria-hidden="true" /> : null}
          {isSaving ? "Saving…" : "Save change"}
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

function readModelOptionBadge(input: {
  current: boolean;
  model: HostedAssistantProductModel;
  selected: boolean;
  unavailable: boolean;
}): React.ReactNode {
  if (input.current) {
    return <ModelOptionBadge>Current</ModelOptionBadge>;
  }

  if (input.selected) {
    return <ModelOptionBadge>Selected</ModelOptionBadge>;
  }

  if (input.unavailable) {
    return <ModelOptionBadge>Edge</ModelOptionBadge>;
  }

  if (input.model === HOSTED_ASSISTANT_TERRA_MODEL) {
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

function readModelName(model: HostedAssistantProductModel): string {
  if (model === HOSTED_ASSISTANT_LUNA_MODEL) {
    return "GPT-5.6 Luna";
  }

  return model === HOSTED_ASSISTANT_SOL_MODEL
    ? "GPT-5.6 Sol"
    : "GPT-5.6 Terra";
}
