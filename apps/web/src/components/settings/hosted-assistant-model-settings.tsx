"use client";

import {
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
      "For everyday check-ins, questions, planning, and follow-through with Murph.",
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    name: "GPT-5.6 Terra",
  },
  {
    description:
      "When you want Murph to dig deeper on complex questions, research, and demanding tasks. Counts more toward your Edge usage limit.",
    model: HOSTED_ASSISTANT_SOL_MODEL,
    name: "GPT-5.6 Sol",
  },
] as const satisfies ReadonlyArray<{
  description: string;
  model: HostedAssistantProductModel;
  name: string;
}>;

interface AssistantModelSettingsResponse {
  model: HostedAssistantProductModel;
  ok: true;
  solAvailable: boolean;
  updated: boolean;
}

interface HostedAssistantModelSettingsProps {
  canUpgradeToEdge: boolean;
  initialModel: HostedAssistantProductModel;
  solAvailable: boolean;
}

export function HostedAssistantModelSettings(
  props: HostedAssistantModelSettingsProps,
) {
  return (
    <HostedAssistantModelSettingsForm
      key={`${props.initialModel}:${String(props.solAvailable)}:${String(props.canUpgradeToEdge)}`}
      {...props}
    />
  );
}

function HostedAssistantModelSettingsForm(
  props: HostedAssistantModelSettingsProps,
) {
  const [currentModel, setCurrentModel] = useState(props.initialModel);
  const [draftModel, setDraftModel] = useState(props.initialModel);
  const [solAvailable, setSolAvailable] = useState(props.solAvailable);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    tone: "destructive" | "success";
  } | null>(null);

  if (!solAvailable) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-pretty text-muted-foreground">
          Terra is your current model. Edge unlocks GPT-5.6 Sol for harder work.
        </p>

        <div
          className="w-full overflow-hidden rounded-xl border border-border bg-background"
          role="list"
          aria-label="Available models"
        >
          {MODEL_OPTIONS.map((option, index) => {
            const current = option.model === HOSTED_ASSISTANT_TERRA_MODEL;

            return (
              <div
                key={option.model}
                role="listitem"
                className={cn(
                  "flex min-h-24 flex-col items-start gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between",
                  index > 0 && "border-t border-border",
                  current && "bg-primary/10",
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
                      {option.name}
                    </span>
                    {current ? (
                      <Badge
                        variant="outline"
                        className="h-5 rounded-md px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        Current
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="h-5 rounded-md px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        Edge
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 max-w-2xl text-sm text-pretty text-muted-foreground">
                    {option.description}
                  </p>
                  {!current ? (
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {props.canUpgradeToEdge
                        ? "Upgrade to Edge to unlock GPT-5.6 Sol."
                        : "Available with an active Edge plan."}
                    </p>
                  ) : null}
                </div>

                {!current && props.canUpgradeToEdge ? (
                  <UpgradeToEdgeButton>Upgrade to Edge</UpgradeToEdgeButton>
                ) : null}
              </div>
            );
          })}
        </div>

        {status ? (
          <SettingsStatusLine message={status.message} tone={status.tone} />
        ) : null}
      </div>
    );
  }

  async function saveModel() {
    setIsSaving(true);
    setStatus(null);

    try {
      const response = await requestHostedOnboardingJson<AssistantModelSettingsResponse>({
        method: "POST",
        payload: { model: draftModel },
        url: ASSISTANT_MODEL_SETTINGS_URL,
      });

      if (!isHostedAssistantProductModel(response.model)) {
        throw new Error("Assistant model response was invalid.");
      }

      setCurrentModel(response.model);
      setDraftModel(response.model);
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
        setCurrentModel(HOSTED_ASSISTANT_TERRA_MODEL);
        setDraftModel(HOSTED_ASSISTANT_TERRA_MODEL);
        setSolAvailable(false);
      }
      setStatus({
        message: solNoLongerAvailable
          ? "Your Edge access changed. GPT-5.6 Terra is now active."
          : "Could not update your default model. Try again.",
        tone: "destructive",
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
        Choose Murph’s default model. You can switch back at any time. New work
        uses the change after the current run closes. An idle run can take up
        to three minutes to close.
      </p>

      <fieldset
        className="w-full overflow-hidden rounded-xl border border-border bg-background disabled:opacity-70"
        disabled={isSaving}
      >
        <legend className="sr-only">Default model</legend>
        {MODEL_OPTIONS.map((option, index) => {
          const selected = draftModel === option.model;
          const nameId = `assistant-model-${option.model}-name`;
          const descriptionId = `assistant-model-${option.model}-description`;

          return (
            <label
              key={option.model}
              className={cn(
                "flex min-h-24 cursor-pointer items-start gap-3 px-4 py-4 transition-colors",
                index > 0 && "border-t border-border",
                selected ? "bg-primary/10" : "hover:bg-muted/50",
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

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-48">
        <Button
          type="submit"
          disabled={isSaving || draftModel === currentModel}
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
  return model === HOSTED_ASSISTANT_SOL_MODEL
    ? "GPT-5.6 Sol"
    : "GPT-5.6 Terra";
}
