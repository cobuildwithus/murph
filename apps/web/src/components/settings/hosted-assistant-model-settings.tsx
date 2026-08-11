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
import { useId, useState } from "react";

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
import type {
  HostedInferenceConnectionView,
} from "@/src/lib/hosted-inference/types";

import {
  ASSISTANT_MODEL_CHOICE_CARD_CLASSES,
  AssistantModelArtwork,
  type AssistantModelArtworkVariant,
} from "./assistant-model-artwork";
import { SettingsStatusLine } from "./connected-account-card";
import { HostedInferenceConnectionPane } from "./hosted-inference-connection-settings";
import { UpgradeToEdgeButton } from "./hosted-plan-upgrade-button";

const ASSISTANT_MODEL_SETTINGS_URL = "/api/settings/assistant-model";
const ASSISTANT_MODE_SETTINGS_URL = "/api/settings/assistant";
const SOL_REQUIRES_EDGE_ERROR_CODE = "ASSISTANT_MODEL_SOL_REQUIRES_EDGE";
const VENICE_UNAVAILABLE_ERROR_CODE = "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE";
const VENICE_USAGE_DISCLOSURE =
  "Venice’s higher provider rates use included AI capacity faster.";

/**
 * Where inference runs. Murph-managed providers and the member's own endpoint
 * are one choice because they answer the same question; the managed provider
 * stays remembered while the endpoint is in use.
 */
export const CUSTOM_INFERENCE_ROUTING = "custom";

export type AssistantRoutingChoice =
  | HostedAssistantProvider
  | typeof CUSTOM_INFERENCE_ROUTING;

function isAssistantRoutingChoice(
  value: string,
): value is AssistantRoutingChoice {
  return value === CUSTOM_INFERENCE_ROUTING || isHostedAssistantProvider(value);
}

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
    description: "No chat history saved.",
    logo: {
      height: 180,
      src: "/brand-logos/assistant-providers/openai-light.svg",
      width: 180,
    },
    name: "OpenAI",
    provider: HOSTED_ASSISTANT_OPENAI_PROVIDER,
  },
  {
    description: "Privacy-first inference.",
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

interface AssistantModeResponse {
  mode: "custom" | "managed";
  updated: boolean;
}

interface HostedAssistantModelSettingsProps {
  canUpgradeToEdge: boolean;
  chatCompletionsAvailable?: boolean;
  configurationAvailable: boolean;
  customInferenceAvailable?: boolean;
  expectedCurrentPlanCode?: "launch_group_monthly" | "launch_monthly";
  initialConnection?: HostedInferenceConnectionView | null;
  initialDormantSolPreference: boolean;
  initialModel: HostedAssistantProductModel;
  initialProvider?: HostedAssistantProvider;
  solAvailable: boolean;
  veniceAvailable?: boolean;
}

interface AssistantProviderDialogProps {
  chatCompletionsAvailable?: boolean;
  configurationAvailable?: boolean;
  connection?: HostedInferenceConnectionView | null;
  customInferenceAvailable?: boolean;
  onConnectionChange?: (
    connection: HostedInferenceConnectionView | null,
  ) => void;
  onOpenChange: (open: boolean) => void;
  onRoutingChange: (routing: AssistantRoutingChoice) => void;
  open: boolean;
  routing: AssistantRoutingChoice;
  veniceAvailable?: boolean;
}

interface AssistantProviderSummaryProps {
  connection?: HostedInferenceConnectionView | null;
  currentRouting: AssistantRoutingChoice;
  disabled?: boolean;
  draftRouting: AssistantRoutingChoice;
  onChangeClick: () => void;
  usageDisclosureId?: string;
}

export function AssistantProviderSummary({
  connection = null,
  currentRouting,
  disabled = false,
  draftRouting,
  onChangeClick,
  usageDisclosureId,
}: AssistantProviderSummaryProps) {
  const generatedUsageDisclosureId = useId();
  const resolvedUsageDisclosureId =
    usageDisclosureId ?? generatedUsageDisclosureId;
  const currentName = readRoutingName(currentRouting);
  const draftName = readRoutingName(draftRouting);
  const hasPendingChange = currentRouting !== draftRouting;
  const displayedName = hasPendingChange ? draftName : currentName;
  const endpointDetail =
    draftRouting === CUSTOM_INFERENCE_ROUTING && connection
      ? `${connection.endpointHost} · ${connection.model}`
      : null;

  return (
    <div className="w-full px-1" data-slot="assistant-provider-summary">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 py-1.5">
          <p className="text-sm font-medium text-foreground">
            Inference on {displayedName}
            {hasPendingChange ? (
              <span className="font-normal text-muted-foreground"> after Save</span>
            ) : null}
          </p>
          {endpointDetail ? (
            <p className="mt-1 font-mono text-xs/5 text-muted-foreground [overflow-wrap:anywhere]">
              {endpointDetail}
            </p>
          ) : null}
        </div>
        <Button
          aria-label={
            hasPendingChange
              ? `Change inference routing. Inference on ${draftName} after Save.`
              : `Change inference routing. Inference on ${currentName}.`
          }
          className="-my-0.5 -mr-2 min-h-10 px-2 text-muted-foreground"
          disabled={disabled}
          onClick={onChangeClick}
          size="sm"
          type="button"
          variant="ghost"
        >
          Change
        </Button>
      </div>
      {draftRouting === HOSTED_ASSISTANT_VENICE_PROVIDER ? (
        <p
          className="mt-2 max-w-2xl text-xs/5 text-pretty text-muted-foreground"
          id={resolvedUsageDisclosureId}
        >
          {VENICE_USAGE_DISCLOSURE}
        </p>
      ) : null}
    </div>
  );
}

export function AssistantProviderDialog({
  chatCompletionsAvailable = false,
  configurationAvailable = true,
  connection = null,
  customInferenceAvailable = false,
  onConnectionChange,
  onOpenChange,
  onRoutingChange,
  open,
  routing,
  veniceAvailable = false,
}: AssistantProviderDialogProps) {
  const [pane, setPane] = useState<"endpoint" | "list">("list");
  const endpointUnsupported =
    connection?.protocol === "chat_completions" && !chatCompletionsAvailable;

  function changeOpen(next: boolean): void {
    if (!next) {
      setPane("list");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto border border-border/80 bg-popover p-5 text-popover-foreground ring-border sm:p-6 ${
          pane === "endpoint"
            ? "max-w-[min(36rem,calc(100vw-2rem))] sm:max-w-[36rem]"
            : "max-w-[min(27rem,calc(100vw-2rem))] sm:max-w-[27rem]"
        }`}
      >
        {pane === "endpoint" ? (
          <>
            <DialogHeader className="gap-1.5 pr-9">
              <DialogTitle className="font-serif text-xl/7 font-semibold tracking-normal">
                Your endpoint
              </DialogTitle>
              <DialogDescription className="max-w-[46ch] text-sm/6">
                Connect one OpenAI-compatible endpoint you operate or pay for.
                Murph never switches away from it after an endpoint failure.
              </DialogDescription>
            </DialogHeader>
            <HostedInferenceConnectionPane
              chatCompletionsAvailable={chatCompletionsAvailable}
              configurationAvailable={configurationAvailable}
              connection={connection}
              onConnectionChange={(next) => onConnectionChange?.(next)}
              selected={connection?.selected === true}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
              <Button
                onClick={() => setPane("list")}
                size="sm"
                type="button"
                variant="ghost"
              >
                Back to providers
              </Button>
              {connection && !endpointUnsupported ? (
                <Button
                  disabled={!configurationAvailable}
                  onClick={() => {
                    onRoutingChange(CUSTOM_INFERENCE_ROUTING);
                    changeOpen(false);
                  }}
                  size="sm"
                  type="button"
                  variant={
                    routing === CUSTOM_INFERENCE_ROUTING ? "outline" : "default"
                  }
                >
                  {routing === CUSTOM_INFERENCE_ROUTING
                    ? "Selected for inference"
                    : "Use for inference"}
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="gap-1.5 pr-9">
              <DialogTitle className="font-serif text-xl/7 font-semibold tracking-normal">
                Choose provider
              </DialogTitle>
              <DialogDescription className="max-w-[38ch] text-sm/6">
                Inference runs here after you save.
              </DialogDescription>
            </DialogHeader>
            <RadioGroup
              aria-label="Inference provider"
              className="gap-2"
              value={routing}
              onValueChange={(value) => {
                if (!isAssistantRoutingChoice(value)) {
                  return;
                }
                onRoutingChange(value);
                changeOpen(false);
              }}
            >
              {PROVIDER_OPTIONS.filter((option) =>
                option.provider !== HOSTED_ASSISTANT_VENICE_PROVIDER
                || veniceAvailable
              ).map((option) => {
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
              {customInferenceAvailable ? (
                <CustomEndpointOption
                  connection={connection}
                  onManage={() => setPane("endpoint")}
                  unsupported={endpointUnsupported}
                />
              ) : null}
            </RadioGroup>
            <p className="px-1 text-xs/5 text-pretty text-muted-foreground">
              The selected provider handles inference. Image generation,
              voice, search, and other tools still use their specialized
              providers.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The member's own endpoint as a peer of the managed providers. It carries a
 * radio only once a verified connection exists, so an unverified endpoint can
 * never be routed to; before that the row is a way into the setup pane.
 */
function CustomEndpointOption({
  connection,
  onManage,
  unsupported,
}: {
  connection: HostedInferenceConnectionView | null;
  onManage: () => void;
  unsupported: boolean;
}) {
  return (
    // min-w-0 keeps this grid item from taking its single-line summary as a
    // min-content floor, which would overflow the dialog on narrow viewports.
    <div className="flex min-h-[4.5rem] min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-background/40 px-3 py-2.5 text-left transition-colors has-[[data-checked]]:border-primary/35 has-[[data-checked]]:bg-primary/[0.035] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-white/80">
        <span
          aria-hidden="true"
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        >
          API
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="text-sm font-medium text-foreground"
          id="assistant-provider-custom-title"
        >
          Your endpoint
        </span>
        <span
          className="truncate text-xs/5 text-muted-foreground"
          id="assistant-provider-custom-description"
        >
          {connection
            ? unsupported
              ? "This connection's protocol is unavailable in this deployment."
              : `${connection.endpointHost} · ${connection.model}`
            : "Connect an OpenAI-compatible endpoint you control."}
        </span>
      </span>
      <Button
        className="shrink-0 text-muted-foreground"
        onClick={onManage}
        size="xs"
        type="button"
        variant="ghost"
      >
        {connection ? "Manage" : "Set up"}
      </Button>
      {connection && !unsupported ? (
        <RadioGroupItem
          aria-describedby="assistant-provider-custom-description"
          aria-labelledby="assistant-provider-custom-title"
          className="size-5"
          id="assistant-provider-custom"
          value={CUSTOM_INFERENCE_ROUTING}
        />
      ) : null}
    </div>
  );
}

export function HostedAssistantModelSettings(
  props: HostedAssistantModelSettingsProps,
) {
  const initialProvider = props.initialProvider ?? HOSTED_ASSISTANT_DEFAULT_PROVIDER;
  const initialConnection = props.initialConnection ?? null;
  return (
    <HostedAssistantModelSettingsForm
      key={`${props.initialModel}:${initialProvider}:${String(props.initialDormantSolPreference)}:${String(props.solAvailable)}:${String(props.configurationAvailable)}:${String(props.canUpgradeToEdge)}:${String(props.veniceAvailable === true)}:${String(props.customInferenceAvailable === true)}:${String(initialConnection?.revision ?? "none")}:${String(initialConnection?.selected === true)}`}
      {...props}
      initialConnection={initialConnection}
      initialProvider={initialProvider}
    />
  );
}

function HostedAssistantModelSettingsForm(
  props: HostedAssistantModelSettingsProps & {
    initialConnection: HostedInferenceConnectionView | null;
    initialProvider: HostedAssistantProvider;
  },
) {
  const [currentModel, setCurrentModel] = useState(props.initialModel);
  const [draftModel, setDraftModel] = useState(props.initialModel);
  const [currentProvider, setCurrentProvider] = useState(props.initialProvider);
  const [connection, setConnection] = useState(props.initialConnection);
  const [draftRouting, setDraftRouting] = useState<AssistantRoutingChoice>(
    props.initialConnection?.selected
      ? CUSTOM_INFERENCE_ROUTING
      : props.initialProvider,
  );
  const [dormantSolPreference, setDormantSolPreference] = useState(
    props.initialDormantSolPreference,
  );
  const [solAvailable, setSolAvailable] = useState(props.solAvailable);
  const [veniceAvailable, setVeniceAvailable] = useState(
    props.veniceAvailable === true,
  );
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const veniceUsageDisclosureId = useId();
  const [status, setStatus] = useState<{
    message: string;
    tone: "destructive" | "neutral";
  } | null>(null);
  const [saveAnnouncement, setSaveAnnouncement] = useState<string | null>(null);
  const controlsDisabled = isSaving || !props.configurationAvailable;
  // The durable connection and provider are the only owners of where replies
  // go; the current route is derived from them so the two can never disagree.
  const currentRouting: AssistantRoutingChoice = connection?.selected
    ? CUSTOM_INFERENCE_ROUTING
    : currentProvider;
  // Selecting the member's own endpoint leaves the saved managed provider
  // untouched so switching back restores it.
  const draftProvider =
    draftRouting === CUSTOM_INFERENCE_ROUTING ? currentProvider : draftRouting;
  const routingChanged = draftRouting !== currentRouting;
  const hasChanges = draftModel !== currentModel
    || routingChanged
    || dormantSolPreference;
  const providerControlsVisible = veniceAvailable
    || props.customInferenceAvailable === true;

  async function saveModel() {
    setIsSaving(true);
    setStatus(null);
    setSaveAnnouncement(null);

    try {
      const enteringCustom = draftRouting === CUSTOM_INFERENCE_ROUTING;
      const providerChanged = veniceAvailable && draftProvider !== currentProvider;
      const modelChanged = draftModel !== currentModel;
      const replaceDormantSol =
        dormantSolPreference && !routingChanged && !providerChanged;
      const modeChanged = enteringCustom !== (currentRouting === CUSTOM_INFERENCE_ROUTING);
      const managedChanged = modelChanged || replaceDormantSol || providerChanged;

      // Each owner is called only when its own values changed, so a route-only
      // save never sends an empty managed-model request the route would reject.
      const saveMode = async () => {
        await requestHostedOnboardingJson<AssistantModeResponse>({
          method: "POST",
          payload: { mode: enteringCustom ? "custom" : "managed" },
          url: ASSISTANT_MODE_SETTINGS_URL,
        });
        setConnection((current) =>
          current ? { ...current, selected: enteringCustom } : current
        );
      };
      const saveManaged = async () => {
        const response = await requestHostedOnboardingJson<
          AssistantModelSettingsResponse
        >({
          method: "POST",
          payload: {
            ...(modelChanged || replaceDormantSol ? { model: draftModel } : {}),
            ...(providerChanged ? { provider: draftProvider } : {}),
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
        setDormantSolPreference(response.dormantSolPreference);
        setSolAvailable(response.solAvailable);
        return {
          dormantSolPreference: response.dormantSolPreference,
          model: response.model,
          provider,
        };
      };

      // Direction-aware ordering keeps the endpoint authoritative across a
      // partial failure: entering custom selects it before the managed default
      // moves, and leaving custom persists the new managed default before the
      // endpoint is released.
      let managed:
        | {
            dormantSolPreference: boolean;
            model: HostedAssistantProductModel;
            provider: HostedAssistantProvider;
          }
        | null = null;
      if (enteringCustom) {
        if (modeChanged) await saveMode();
        if (managedChanged) managed = await saveManaged();
      } else {
        if (managedChanged) managed = await saveManaged();
        if (modeChanged) await saveMode();
      }
      // Adopt the canonical provider the route returned, so the draft cannot
      // keep proposing a value the server already replaced.
      setDraftRouting(
        enteringCustom
          ? CUSTOM_INFERENCE_ROUTING
          : managed?.provider ?? draftProvider,
      );

      const savedModel = managed?.model ?? currentModel;
      const savedProvider = managed?.provider ?? currentProvider;
      setSaveAnnouncement(
        enteringCustom
          ? `Saved. Inference on your endpoint. ${readProductModelName(savedModel)} through ${readProviderName(savedProvider)} stays your managed default.`
          : (managed?.dormantSolPreference ?? dormantSolPreference)
          ? `Saved. Inference on ${readProductModelName(savedModel)} through ${readProviderName(savedProvider)} while Edge is paused; Sol remains saved.`
          : `Saved. ${readProductModelName(savedModel)} through ${readProviderName(savedProvider)} is your default.`,
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
        if (draftRouting !== CUSTOM_INFERENCE_ROUTING) {
          setDraftRouting(HOSTED_ASSISTANT_OPENAI_PROVIDER);
        }
        setVeniceAvailable(false);
        setProviderDialogOpen(false);
      }
      setStatus({
        message: solNoLongerAvailable
          ? props.customInferenceAvailable
            ? `Your Edge access changed. Your managed default stays ${readModelName(currentModel)}.`
            : `Your Edge access changed. Murph will keep using ${readModelName(currentModel)}.`
          : veniceNoLongerAvailable
            ? props.customInferenceAvailable
              ? "Venice is no longer available. OpenAI remains your saved managed provider."
              : "Venice is no longer available. Murph will keep using OpenAI."
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
          {props.customInferenceAvailable
            ? "Choose the model Murph uses whenever Murph-managed inference is selected."
            : "Choose the intelligence behind your personal health assistant."}
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
            {props.customInferenceAvailable
              ? "Terra is your managed default while Edge is paused. Sol is still saved and will return with Edge. Choose Luna or save Terra to replace it."
              : "Terra is active while Edge is paused. Sol is still saved and will return with Edge. Choose Luna or save Terra to replace it."}
          </p>
        ) : null}

        <FieldSet
          className="w-full gap-3"
          disabled={controlsDisabled}
        >
          <FieldLegend className="sr-only">
            {props.customInferenceAvailable
              ? "Managed default model"
              : "Default model"}
          </FieldLegend>
          <FieldDescription className="sr-only">
            {props.customInferenceAvailable
              ? "Choose the saved model for Murph-managed inference."
              : "Choose one model for new Murph replies."}
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
                dormantSolPreference,
                managedDefaultOnly: props.customInferenceAvailable === true,
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

        {providerControlsVisible ? (
          <AssistantProviderSummary
            connection={connection}
            currentRouting={currentRouting}
            disabled={controlsDisabled}
            draftRouting={draftRouting}
            onChangeClick={() => setProviderDialogOpen(true)}
            usageDisclosureId={veniceUsageDisclosureId}
          />
        ) : null}

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
            aria-describedby={
              providerControlsVisible
                && draftRouting === HOSTED_ASSISTANT_VENICE_PROVIDER
                ? veniceUsageDisclosureId
                : undefined
            }
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
      {providerControlsVisible ? (
        <AssistantProviderDialog
          chatCompletionsAvailable={props.chatCompletionsAvailable}
          configurationAvailable={props.configurationAvailable}
          connection={connection}
          customInferenceAvailable={props.customInferenceAvailable}
          onConnectionChange={(next) => {
            setConnection(next);
            // A deleted connection, and a replacement the store saves as
            // deselected, both return this member to managed inference. The
            // draft has to follow, or the new revision would look active
            // without the member ever selecting it.
            if (!next?.selected) {
              setDraftRouting((current) =>
                current === CUSTOM_INFERENCE_ROUTING ? currentProvider : current
              );
            }
            setStatus(null);
          }}
          onOpenChange={setProviderDialogOpen}
          onRoutingChange={(routing) => {
            setDraftRouting(routing);
            setStatus(null);
          }}
          open={providerDialogOpen}
          routing={draftRouting}
          veniceAvailable={veniceAvailable}
        />
      ) : null}
    </>
  );
}

function readModelOptionBadge(input: {
  current: boolean;
  dormantSolPreference: boolean;
  managedDefaultOnly: boolean;
  model: HostedAssistantProductModel;
  selected: boolean;
  unavailable: boolean;
}): React.ReactNode {
  if (input.current) {
    return (
      <ModelOptionBadge>
        {input.managedDefaultOnly
          ? "Managed default"
          : input.dormantSolPreference ? "Active" : "Default"}
      </ModelOptionBadge>
    );
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

function readRoutingName(routing: AssistantRoutingChoice): string {
  return routing === CUSTOM_INFERENCE_ROUTING
    ? "your endpoint"
    : readProviderName(routing);
}
