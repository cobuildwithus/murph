"use client";

import {
  HOSTED_ASSISTANT_DEFAULT_PROVIDER,
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_OPENAI_PROVIDER,
  HOSTED_ASSISTANT_SOL_MODEL,
  HOSTED_ASSISTANT_TERRA_MODEL,
  HOSTED_ASSISTANT_VENICE_PROVIDER,
  isHostedAssistantProductModel,
  isHostedAssistantProvider,
  type HostedAssistantProductModel,
  type HostedAssistantProvider,
} from "@murphai/hosted-execution/assistant-model";
import Image from "next/image";
import { useState } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  FieldDescription,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/src/components/ui/radio-group";
import { Spinner } from "@/src/components/ui/spinner";

import {
  ASSISTANT_MODEL_CHOICE_CARD_CLASSES,
  AssistantModelArtwork,
  type AssistantModelArtworkVariant,
} from "./assistant-model-artwork";
import { SettingsStatusLine } from "./connected-account-card";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";

const ASSISTANT_MODEL_SETTINGS_URL = "/api/settings/assistant-model";
const SOL_REQUIRES_EDGE_ERROR_CODE = "ASSISTANT_MODEL_SOL_REQUIRES_EDGE";
const VENICE_UNAVAILABLE_ERROR_CODE = "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE";

const MODEL_OPTIONS = [
  {
    artwork: "luna",
    description: "Fast health intelligence",
    model: HOSTED_ASSISTANT_LUNA_MODEL,
    name: "Luna",
    usage: "Low usage",
  },
  {
    artwork: "terra",
    description: "Advanced health intelligence",
    model: HOSTED_ASSISTANT_TERRA_MODEL,
    name: "Terra",
    usage: "Balanced usage",
  },
  {
    artwork: "sol",
    description: "Highest health intelligence",
    model: HOSTED_ASSISTANT_SOL_MODEL,
    name: "Sol",
    usage: "High usage",
  },
] as const satisfies ReadonlyArray<{
  artwork: AssistantModelArtworkVariant;
  description: string;
  model: HostedAssistantProductModel;
  name: string;
  usage: string;
}>;

const PROVIDER_OPTIONS = [
  {
    description: "Direct inference through OpenAI",
    logo: {
      height: 180,
      src: "/brand-logos/assistant-providers/openai-light.svg",
      width: 180,
    },
    name: "OpenAI",
    provider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
  },
  {
    description: "Privacy-first. Venice stores no prompts or replies.",
    logo: {
      height: 356,
      src: "/brand-logos/assistant-providers/venice-light.svg",
      width: 319,
    },
    name: "Venice",
    provider: HOSTED_ASSISTANT_VENICE_PROVIDER,
  },
] as const satisfies ReadonlyArray<{
  description: string;
  logo: {
    height: number;
    src: string;
    width: number;
  };
  name: string;
  provider: HostedAssistantProvider;
}>;

interface AssistantModelSettingsResponse {
  dormantSolPreference: boolean;
  model: HostedAssistantProductModel;
  ok: true;
  provider?: HostedAssistantProvider;
  solAvailable: boolean;
  updated: boolean;
}

interface HostedAssistantModelSettingsProps {
  canUpgradeToEdge: boolean;
  configurationAvailable: boolean;
  initialDormantSolPreference: boolean;
  initialModel: HostedAssistantProductModel;
  initialProvider?: HostedAssistantProvider;
  solAvailable: boolean;
  veniceAvailable?: boolean;
}

interface AssistantProviderDialogProps {
  onOpenChange: (open: boolean) => void;
  onProviderChange: (provider: HostedAssistantProvider) => void;
  open: boolean;
  provider: HostedAssistantProvider;
}

interface AssistantProviderSummaryProps {
  currentProvider: HostedAssistantProvider;
  disabled?: boolean;
  draftProvider: HostedAssistantProvider;
  onChangeClick: () => void;
}

export function AssistantProviderSummary({
  currentProvider,
  disabled = false,
  draftProvider,
  onChangeClick,
}: AssistantProviderSummaryProps) {
  const currentProviderName = readProviderName(currentProvider);
  const draftProviderName = readProviderName(draftProvider);
  const hasPendingChange = currentProvider !== draftProvider;

  return (
    <div className="flex w-full items-center gap-2 px-1">
      <p className="text-sm text-muted-foreground">
        {hasPendingChange ? (
          <>
            Core replies switch to{" "}
            <span className="font-medium text-foreground">
              {draftProviderName}
            </span>{" "}
            after Save.
          </>
        ) : (
          <>
            New core replies use{" "}
            <span className="font-medium text-foreground">
              {currentProviderName}
            </span>
            .
          </>
        )}
      </p>
      <Button
        aria-label={
          hasPendingChange
            ? `Change model provider. Core replies will switch to ${draftProviderName} after Save.`
            : `Change model provider. New core replies use ${currentProviderName}.`
        }
        className="text-muted-foreground"
        disabled={disabled}
        onClick={onChangeClick}
        size="xs"
        type="button"
        variant="ghost"
      >
        Change
      </Button>
    </div>
  );
}

export function AssistantProviderDialog({
  onOpenChange,
  onProviderChange,
  open,
  provider,
}: AssistantProviderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[min(27rem,calc(100vw-2rem))] gap-5 overflow-y-auto border border-border/80 bg-popover p-5 text-popover-foreground ring-border sm:max-w-[27rem] sm:p-6">
        <DialogHeader className="gap-1.5 pr-9">
          <DialogTitle className="font-serif text-xl/7 font-semibold tracking-normal">
            Choose provider
          </DialogTitle>
          <DialogDescription className="max-w-[38ch] text-sm/6">
            Core replies use this provider after you save.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          aria-label="Model provider"
          className="gap-2"
          value={provider}
          onValueChange={(value) => {
            if (!isHostedAssistantProvider(value)) {
              return;
            }
            onProviderChange(value);
            onOpenChange(false);
          }}
        >
          {PROVIDER_OPTIONS.map((option) => {
            const titleId = `assistant-provider-${option.provider}-title`;
            const descriptionId =
              `assistant-provider-${option.provider}-description`;
            return (
              <label
                className="flex min-h-[4.5rem] cursor-pointer items-center gap-3 rounded-2xl border border-border/70 bg-background/40 px-3 py-2.5 text-left transition-colors hover:bg-muted/45 has-[[data-checked]]:border-primary/35 has-[[data-checked]]:bg-primary/[0.035] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                htmlFor={`assistant-provider-${option.provider}`}
                key={option.provider}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-white/80">
                  <Image
                    alt=""
                    aria-hidden="true"
                    className="size-8 object-contain [color-scheme:light]"
                    height={option.logo.height}
                    src={option.logo.src}
                    width={option.logo.width}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className="text-sm font-medium text-foreground"
                    id={titleId}
                  >
                    {option.name}
                  </span>
                  <span
                    className="text-xs/5 text-muted-foreground"
                    id={descriptionId}
                  >
                    {option.description}
                  </span>
                </span>
                <RadioGroupItem
                  aria-describedby={descriptionId}
                  aria-labelledby={titleId}
                  className="size-5"
                  id={`assistant-provider-${option.provider}`}
                  value={option.provider}
                />
              </label>
            );
          })}
        </RadioGroup>
        <p className="px-1 text-xs/5 text-pretty text-muted-foreground">
          This only changes core replies. Image generation, voice, search, and
          other tools still use their specialized providers.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function HostedAssistantModelSettings(
  props: HostedAssistantModelSettingsProps,
) {
  const initialProvider = props.initialProvider ?? HOSTED_ASSISTANT_DEFAULT_PROVIDER;
  return (
    <HostedAssistantModelSettingsForm
      key={`${props.initialModel}:${initialProvider}:${String(props.initialDormantSolPreference)}:${String(props.solAvailable)}:${String(props.configurationAvailable)}:${String(props.canUpgradeToEdge)}:${String(props.veniceAvailable === true)}`}
      {...props}
      initialProvider={initialProvider}
    />
  );
}

function HostedAssistantModelSettingsForm(
  props: HostedAssistantModelSettingsProps & {
    initialProvider: HostedAssistantProvider;
  },
) {
  const [currentModel, setCurrentModel] = useState(props.initialModel);
  const [draftModel, setDraftModel] = useState(props.initialModel);
  const [currentProvider, setCurrentProvider] = useState(props.initialProvider);
  const [draftProvider, setDraftProvider] = useState(props.initialProvider);
  const [dormantSolPreference, setDormantSolPreference] = useState(
    props.initialDormantSolPreference,
  );
  const [solAvailable, setSolAvailable] = useState(props.solAvailable);
  const [veniceAvailable, setVeniceAvailable] = useState(
    props.veniceAvailable === true,
  );
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<{
    message: string;
    tone: "destructive" | "neutral";
  } | null>(null);
  const [saveAnnouncement, setSaveAnnouncement] = useState<string | null>(null);
  const controlsDisabled = isSaving || !props.configurationAvailable;
  const hasChanges =
    draftModel !== currentModel
    || draftProvider !== currentProvider
    || dormantSolPreference;

  async function saveModel() {
    setIsSaving(true);
    setStatus(null);
    setSaveAnnouncement(null);

    try {
      const modelChanged = draftModel !== currentModel;
      const providerChanged = draftProvider !== currentProvider;
      const replaceDormantSol = dormantSolPreference && !providerChanged;
      const response = await requestHostedOnboardingJson<AssistantModelSettingsResponse>({
        method: "POST",
        payload: {
          ...(modelChanged || replaceDormantSol
            ? { model: draftModel }
            : {}),
          ...(veniceAvailable && providerChanged
            ? { provider: draftProvider }
            : {}),
        },
        url: ASSISTANT_MODEL_SETTINGS_URL,
      });

      if (
        !isHostedAssistantProductModel(response.model)
        || (
          veniceAvailable
            ? !isHostedAssistantProvider(response.provider)
            : response.provider !== undefined
              && !isHostedAssistantProvider(response.provider)
        )
        || typeof response.dormantSolPreference !== "boolean"
        || typeof response.solAvailable !== "boolean"
      ) {
        throw new Error("Assistant model response was invalid.");
      }

      const provider = isHostedAssistantProvider(response.provider)
        ? response.provider
        : draftProvider;
      setCurrentModel(response.model);
      setDraftModel(response.model);
      setCurrentProvider(provider);
      setDraftProvider(provider);
      setDormantSolPreference(response.dormantSolPreference);
      setSolAvailable(response.solAvailable);
      setSaveAnnouncement(
        `Saved. ${readProductModelName(response.model)} through ${readProviderName(provider)} is your default.`,
      );
    } catch (error) {
      const solNoLongerAvailable =
        error instanceof HostedOnboardingApiError &&
        error.code === SOL_REQUIRES_EDGE_ERROR_CODE;
      const veniceNoLongerAvailable =
        error instanceof HostedOnboardingApiError &&
        error.code === VENICE_UNAVAILABLE_ERROR_CODE;
      if (solNoLongerAvailable) {
        setDraftModel(currentModel);
        setSolAvailable(false);
      }
      if (veniceNoLongerAvailable) {
        setCurrentProvider(HOSTED_ASSISTANT_OPENAI_PROVIDER);
        setDraftProvider(HOSTED_ASSISTANT_OPENAI_PROVIDER);
        setVeniceAvailable(false);
        setProviderDialogOpen(false);
      }
      setStatus({
        message: solNoLongerAvailable
          ? `Your Edge access changed. Murph will keep using ${readModelName(currentModel)}.`
          : veniceNoLongerAvailable
            ? "Venice is no longer available. Murph will keep using OpenAI."
          : "We couldn’t save this change. Try again.",
        tone: solNoLongerAvailable || veniceNoLongerAvailable
          ? "neutral"
          : "destructive",
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
      <p className="max-w-2xl text-sm text-pretty text-muted-foreground">
        Choose the intelligence behind your personal health assistant.
      </p>

      {!props.configurationAvailable ? (
        <p className="w-full rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
          {veniceAvailable
            ? "Provider and model choices are read-only until personal Murph access is active."
            : "Model choices are read-only until personal Murph access is active."}
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
                artwork={<AssistantModelArtwork variant={option.artwork} />}
                badge={badge}
                className={
                  ASSISTANT_MODEL_CHOICE_CARD_CLASSES[option.artwork]
                }
                description={option.description}
                disabled={controlsDisabled || unavailable}
                id={`assistant-model-${option.model}`}
                key={option.model}
                meta={
                  unavailable
                    ? `${option.usage} · Edge required`
                    : option.usage
                }
                title={option.name}
                value={option.model}
              />
            );
          })}
        </RadioGroup>
      </FieldSet>

      {veniceAvailable ? (
        <>
          <AssistantProviderSummary
            currentProvider={currentProvider}
            disabled={controlsDisabled}
            draftProvider={draftProvider}
            onChangeClick={() => setProviderDialogOpen(true)}
          />
          <AssistantProviderDialog
            onOpenChange={setProviderDialogOpen}
            onProviderChange={(provider) => {
              setDraftProvider(provider);
              setStatus(null);
            }}
            open={providerDialogOpen}
            provider={draftProvider}
          />
        </>
      ) : null}

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
        {status ? (
          <SettingsStatusLine
            message={status.message}
            tone={status.tone}
          />
        ) : null}
        {saveAnnouncement ? (
          <SettingsStatusLine
            className="sr-only min-h-0"
            message={saveAnnouncement}
            tone="neutral"
          />
        ) : null}
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
    return <ModelOptionBadge>Default</ModelOptionBadge>;
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
  return `GPT-5.6 ${readProductModelName(model)}`;
}

function readProductModelName(model: HostedAssistantProductModel): string {
  if (model === HOSTED_ASSISTANT_LUNA_MODEL) {
    return "Luna";
  }
  return model === HOSTED_ASSISTANT_SOL_MODEL ? "Sol" : "Terra";
}

function readProviderName(provider: HostedAssistantProvider): string {
  return provider === HOSTED_ASSISTANT_VENICE_PROVIDER ? "Venice" : "OpenAI";
}
