"use client";

import {
  HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS,
  HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS,
  isHostedInferenceAuthKind,
  isHostedInferenceProtocol,
  type HostedInferenceAuthKind,
  type HostedInferenceProtocol,
} from "@murphai/hosted-execution/assistant-inference";
import { useRef, useState } from "react";

import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import { Checkbox } from "@/src/components/ui/checkbox";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { RadioGroup } from "@/src/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Separator } from "@/src/components/ui/separator";
import { Spinner } from "@/src/components/ui/spinner";
import type {
  HostedInferenceConnectionView,
} from "@/src/lib/hosted-inference/types";

import { SettingsStatusLine } from "./connected-account-card";

const HOSTED_INFERENCE_CONNECTION_URL =
  "/api/settings/inference-connection";
const HOSTED_ASSISTANT_MODE_URL = "/api/settings/assistant";
const DEFAULT_CONTEXT_WINDOW_TOKENS = 131_072;
const PROTOCOL_LABELS: Record<HostedInferenceProtocol, string> = {
  chat_completions: "Chat Completions",
  responses: "Responses API",
};
const AUTH_KIND_LABELS: Record<HostedInferenceAuthKind, string> = {
  api_key: "api-key header",
  bearer: "Bearer token",
  x_api_key: "x-api-key header",
};

interface HostedInferenceConnectionSettingsProps {
  chatCompletionsAvailable: boolean;
  configurationAvailable: boolean;
  initialConnection: HostedInferenceConnectionView | null;
}

interface ConnectionMutationResponse {
  connection: HostedInferenceConnectionView;
}

interface AssistantModeResponse {
  mode: "custom" | "managed";
  updated: boolean;
}

export function HostedInferenceConnectionSettings(
  props: HostedInferenceConnectionSettingsProps,
) {
  const initialMode = props.initialConnection?.selected
    ? "custom"
    : "managed";
  const [connection, setConnection] = useState(props.initialConnection);
  const [currentMode, setCurrentMode] = useState<"custom" | "managed">(
    initialMode,
  );
  const [draftMode, setDraftMode] = useState<"custom" | "managed">(
    initialMode,
  );
  const [editing, setEditing] = useState(props.initialConnection === null);
  const [protocol, setProtocol] = useState<HostedInferenceProtocol>(
    props.initialConnection?.protocol ?? "responses",
  );
  const [endpointUrl, setEndpointUrl] = useState("");
  const [model, setModel] = useState(props.initialConnection?.model ?? "");
  const [authKind, setAuthKind] = useState<HostedInferenceAuthKind>("bearer");
  const [secret, setSecret] = useState("");
  const [contextWindowTokens, setContextWindowTokens] = useState(
    String(
      props.initialConnection?.contextWindowTokens
      ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    ),
  );
  const [supportsImages, setSupportsImages] = useState(
    props.initialConnection?.supportsImages ?? false,
  );
  const [pendingAction, setPendingAction] = useState<
    "connection" | "delete" | "mode" | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<{
    action: "connection" | "mode";
    announcement?: string;
    message: string;
    tone: "destructive" | "neutral";
  } | null>(null);
  const confirmDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const connectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const deleteConnectionButtonRef = useRef<HTMLButtonElement>(null);
  const protocolTriggerRef = useRef<HTMLButtonElement>(null);
  const replaceButtonRef = useRef<HTMLButtonElement>(null);
  const disabled = pendingAction !== null || !props.configurationAvailable;
  const modeChanged = currentMode !== draftMode;

  async function saveMode(): Promise<void> {
    if (draftMode === "custom" && !connection) {
      setStatus({
        action: "mode",
        message: "Verify a connection before switching to your endpoint.",
        tone: "neutral",
      });
      setEditing(true);
      return;
    }
    if (
      draftMode === "custom"
      && connection?.protocol === "chat_completions"
      && !props.chatCompletionsAvailable
    ) {
      setStatus({
        action: "mode",
        message:
          "Chat Completions connections are not available in this deployment.",
        tone: "destructive",
      });
      return;
    }
    setPendingAction("mode");
    setStatus(null);
    try {
      const response = await requestHostedOnboardingJson<AssistantModeResponse>({
        method: "POST",
        payload: { mode: draftMode },
        url: HOSTED_ASSISTANT_MODE_URL,
      });
      setCurrentMode(response.mode);
      setDraftMode(response.mode);
      setConnection((current) =>
        current ? { ...current, selected: response.mode === "custom" } : current
      );
      setStatus({
        action: "mode",
        announcement: response.mode === "custom"
          ? "Inference mode saved. New core replies use your verified endpoint."
          : "Inference mode saved. New core replies use Murph-managed inference.",
        message: "Inference mode saved.",
        tone: "neutral",
      });
    } catch (error) {
      setStatus({
        action: "mode",
        message: readSafeConnectionError(
          error,
          "We couldn’t change the inference mode. Try again.",
        ),
        tone: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function verifyConnection(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const parsedContext = Number(contextWindowTokens);
    if (
      !Number.isSafeInteger(parsedContext)
      || parsedContext < HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS
      || parsedContext > HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS
    ) {
      setStatus({
        action: "connection",
        message:
          `Context window must be between ${HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS.toLocaleString()} and ${HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS.toLocaleString()} tokens.`,
        tone: "destructive",
      });
      return;
    }

    setPendingAction("connection");
    setStatus(null);
    try {
      const response =
        await requestHostedOnboardingJson<ConnectionMutationResponse>({
          method: "PUT",
          payload: {
            auth: { kind: authKind, secret },
            contextWindowTokens: parsedContext,
            endpointUrl,
            expectedRevision: connection?.revision ?? null,
            model,
            protocol,
            supportsImages,
          },
          url: HOSTED_INFERENCE_CONNECTION_URL,
        });
      setConnection(response.connection);
      setCurrentMode("managed");
      setDraftMode("managed");
      setEndpointUrl("");
      setSecret("");
      setEditing(false);
      setConfirmDelete(false);
      setStatus({
        action: "connection",
        message:
          "Verified and saved. This connection stays inactive until you select Your endpoint and save the inference mode.",
        tone: "neutral",
      });
      requestAnimationFrame(() => connectionHeadingRef.current?.focus());
    } catch (error) {
      setStatus({
        action: "connection",
        message: readSafeConnectionError(
          error,
          "The endpoint could not be verified. Your previous connection was not changed.",
        ),
        tone: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteConnection(): Promise<void> {
    if (!connection) return;
    setPendingAction("delete");
    setStatus(null);
    try {
      await requestHostedOnboardingJson<{ deleted: true }>({
        method: "DELETE",
        payload: { expectedRevision: connection.revision },
        url: HOSTED_INFERENCE_CONNECTION_URL,
      });
      setConnection(null);
      setCurrentMode("managed");
      setDraftMode("managed");
      setEditing(true);
      setConfirmDelete(false);
      setModel("");
      setEndpointUrl("");
      setSecret("");
      setStatus({
        action: "connection",
        announcement:
          "Connection deleted. New core replies use Murph-managed inference.",
        message: "Connection deleted.",
        tone: "neutral",
      });
      requestAnimationFrame(() => connectionHeadingRef.current?.focus());
    } catch (error) {
      setStatus({
        action: "connection",
        message: readSafeConnectionError(
          error,
          "We couldn’t delete the connection. Try again.",
        ),
        tone: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-sm text-pretty text-muted-foreground">
          Core replies can use Murph-managed inference or one endpoint you
          control. Murph never switches away from your endpoint after an
          endpoint failure.
        </p>
        <p className="text-xs/5 text-pretty text-muted-foreground">
          When your endpoint is selected, Murph sends relevant conversation
          context, tool descriptions, and supported attachments to it.
        </p>
        <p className="text-xs/5 text-pretty text-muted-foreground">
          Image generation, voice, search, and other specialized tools may
          still use Murph providers and remain subject to your plan.
        </p>
      </div>

      <p className="max-w-2xl text-sm text-pretty text-foreground">
        New core replies use {currentMode === "custom"
          ? "your verified endpoint"
          : "Murph-managed inference"}.
      </p>

      {!props.configurationAvailable ? (
        <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
          Inference choices are read-only until personal Murph access is active.
        </p>
      ) : null}

      <FieldSet className="w-full gap-3" disabled={disabled}>
        <FieldLegend className="sr-only">Inference mode</FieldLegend>
        <RadioGroup
          className="grid gap-3 md:grid-cols-2"
          disabled={disabled}
          onValueChange={(value) => {
            if (value !== "managed" && value !== "custom") return;
            setDraftMode(value);
            setStatus(null);
            if (value === "custom" && !connection) setEditing(true);
          }}
          value={draftMode}
        >
          <ChoiceCard
            description="Murph operates the model connection and usage."
            disabled={disabled}
            id="assistant-inference-managed"
            meta={currentMode === "managed" ? "Current" : "Available"}
            title="Managed by Murph"
            value="managed"
          />
          <ChoiceCard
            description="Core conversation content goes to your verified endpoint."
            disabled={disabled}
            id="assistant-inference-custom"
            meta={connection
              ? (
                  <span className="normal-case [overflow-wrap:anywhere]">
                    {connection.endpointHost} · {connection.model}
                  </span>
                )
              : "Connection required"}
            title="Your endpoint"
            value="custom"
          />
        </RadioGroup>
      </FieldSet>

      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <Button
          disabled={disabled || !modeChanged}
          onClick={() => void saveMode()}
          type="button"
        >
          {pendingAction === "mode" ? <Spinner aria-hidden="true" /> : null}
          {pendingAction === "mode" ? "Saving…" : "Save inference mode"}
        </Button>
        {draftMode === "custom" && !connection ? (
          <span className="text-xs text-muted-foreground">
            Verify a connection below first.
          </span>
        ) : null}
      </div>
      {status?.action === "mode" ? (
        <SettingsStatusLine
          announce={status.tone === "destructive"}
          message={status.message}
          tone={status.tone}
        />
      ) : null}

      <Separator />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3
            className="rounded-sm text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
            ref={connectionHeadingRef}
            tabIndex={-1}
          >
            Custom connection
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The credential is encrypted and is never placed in the assistant
            runner.
          </p>
        </div>
        {connection && !editing ? (
          <Button
            disabled={disabled}
            onClick={() => {
              setEditing(true);
              setStatus(null);
              requestAnimationFrame(() => protocolTriggerRef.current?.focus());
            }}
            ref={replaceButtonRef}
            size="sm"
            type="button"
            variant="outline"
          >
            Replace
          </Button>
        ) : null}
      </div>

      {connection && !editing ? (
        <dl className="grid gap-x-8 gap-y-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-4">
          <ConnectionFact label="Endpoint" value={connection.endpointHost} />
          <ConnectionFact label="Model" value={connection.model} />
          <ConnectionFact
            label="Protocol"
            value={
              connection.protocol === "responses"
                ? "Responses API"
                : "Chat Completions"
            }
          />
          <ConnectionFact
            label="Context"
            value={`${connection.contextWindowTokens.toLocaleString()} tokens`}
          />
          <ConnectionFact
            label="Images"
            value={connection.supportsImages ? "Verified" : "Unavailable"}
          />
          <ConnectionFact
            label="Revision"
            value={String(connection.revision)}
          />
          <ConnectionFact
            label="Verified"
            value={formatVerificationTime(connection.verifiedAt)}
          />
          <ConnectionFact
            label="Status"
            value={connection.selected ? "In use" : "Verified, inactive"}
          />
        </dl>
      ) : (
        <form
          aria-busy={pendingAction === "connection"}
          className="flex max-w-3xl flex-col gap-5"
          onSubmit={(event) => void verifyConnection(event)}
        >
          {connection ? (
            <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Replacing this connection requires the credential again. The
              current connection stays unchanged unless verification succeeds.
            </p>
          ) : null}
          <FieldSet className="gap-5" disabled={disabled}>
            <FieldLegend className="sr-only">
              Custom connection details
            </FieldLegend>
            <FieldGroup className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="hosted-inference-protocol">
                  Protocol
                </FieldLabel>
                <Select
                  items={PROTOCOL_LABELS}
                  onValueChange={(value) => {
                    if (value && isHostedInferenceProtocol(value)) {
                      setProtocol(value);
                    }
                  }}
                  value={protocol}
                >
                  <SelectTrigger
                    id="hosted-inference-protocol"
                    ref={protocolTriggerRef}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="responses">Responses API</SelectItem>
                    {props.chatCompletionsAvailable ? (
                      <SelectItem value="chat_completions">
                        Chat Completions
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="hosted-inference-auth-kind">
                  Authentication
                </FieldLabel>
                <Select
                  items={AUTH_KIND_LABELS}
                  onValueChange={(value) => {
                    if (value && isHostedInferenceAuthKind(value)) {
                      setAuthKind(value);
                    }
                  }}
                  value={authKind}
                >
                  <SelectTrigger id="hosted-inference-auth-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bearer">Bearer token</SelectItem>
                    <SelectItem value="api_key">api-key header</SelectItem>
                    <SelectItem value="x_api_key">x-api-key header</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="hosted-inference-endpoint">
                  Exact operation URL
                </FieldLabel>
                <Input
                  autoComplete="url"
                  id="hosted-inference-endpoint"
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  placeholder={
                    protocol === "responses"
                      ? "https://inference.example.com/v1/responses"
                      : "https://inference.example.com/v1/chat/completions"
                  }
                  required
                  type="url"
                  value={endpointUrl}
                />
                <FieldDescription>
                  Public HTTPS on port 443. Redirects and private-network
                  destinations are rejected.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="hosted-inference-model">
                  Model ID
                </FieldLabel>
                <Input
                  autoComplete="off"
                  id="hosted-inference-model"
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="provider-model-id"
                  required
                  value={model}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="hosted-inference-context-window">
                  Context window
                </FieldLabel>
                <Input
                  id="hosted-inference-context-window"
                  inputMode="numeric"
                  max={HOSTED_INFERENCE_CONTEXT_WINDOW_MAX_TOKENS}
                  min={HOSTED_INFERENCE_CONTEXT_WINDOW_MIN_TOKENS}
                  onChange={(event) =>
                    setContextWindowTokens(event.target.value)
                  }
                  required
                  step={1}
                  type="number"
                  value={contextWindowTokens}
                />
                <FieldDescription>
                  Configured value, not independently measured.
                </FieldDescription>
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="hosted-inference-secret">
                  API credential
                </FieldLabel>
                <Input
                  autoComplete="new-password"
                  id="hosted-inference-secret"
                  onChange={(event) => setSecret(event.target.value)}
                  required
                  type="password"
                  value={secret}
                />
              </Field>
            </FieldGroup>
            <Field className="max-w-xl" orientation="horizontal">
              <Checkbox
                aria-describedby="hosted-inference-images-description"
                checked={supportsImages}
                id="hosted-inference-images"
                onCheckedChange={setSupportsImages}
              />
              <FieldContent>
                <FieldLabel
                  className="cursor-pointer"
                  htmlFor="hosted-inference-images"
                >
                  Verify image input
                </FieldLabel>
                <FieldDescription
                  className="text-xs/5"
                  id="hosted-inference-images-description"
                >
                  Enable only when this model accepts image content. Murph fails
                  explicitly if an image reaches a text-only endpoint.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldSet>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={disabled} type="submit">
              {pendingAction === "connection" ? (
                <Spinner aria-hidden="true" />
              ) : null}
              {pendingAction === "connection"
                ? "Verifying…"
                : "Verify and save"}
            </Button>
            {connection ? (
              <Button
                disabled={disabled}
                onClick={() => {
                  setEditing(false);
                  setProtocol(connection.protocol);
                  setModel(connection.model);
                  setContextWindowTokens(
                    String(connection.contextWindowTokens),
                  );
                  setSupportsImages(connection.supportsImages);
                  setEndpointUrl("");
                  setSecret("");
                  setStatus(null);
                  requestAnimationFrame(() => replaceButtonRef.current?.focus());
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      )}

      {connection && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {confirmDelete ? (
            <>
              <span
                className="mr-1 text-sm text-muted-foreground"
                id="hosted-inference-delete-description"
              >
                {currentMode === "custom"
                  ? "Delete the saved endpoint and credential? New core replies will switch to Murph-managed inference."
                  : "Delete the saved endpoint and credential?"}
              </span>
              <Button
                aria-describedby="hosted-inference-delete-description"
                disabled={disabled}
                onClick={() => void deleteConnection()}
                ref={confirmDeleteButtonRef}
                size="sm"
                type="button"
                variant="destructive"
              >
                {pendingAction === "delete" ? (
                  <Spinner aria-hidden="true" />
                ) : null}
                {pendingAction === "delete" ? "Deleting…" : "Delete"}
              </Button>
              <Button
                disabled={disabled}
                onClick={() => {
                  setConfirmDelete(false);
                  requestAnimationFrame(() =>
                    deleteConnectionButtonRef.current?.focus()
                  );
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                Keep connection
              </Button>
            </>
          ) : (
            <Button
              disabled={disabled}
              onClick={() => {
                setConfirmDelete(true);
                requestAnimationFrame(() =>
                  confirmDeleteButtonRef.current?.focus()
                );
              }}
              ref={deleteConnectionButtonRef}
              size="sm"
              type="button"
              variant="ghost"
            >
              Delete connection
            </Button>
          )}
        </div>
      ) : null}

      {status?.action === "connection" ? (
        <SettingsStatusLine
          announce={status.tone === "destructive"}
          message={status.message}
          tone={status.tone}
        />
      ) : null}
      <SettingsStatusLine
        className="sr-only min-h-0"
        message={status?.tone === "destructive"
          ? null
          : status?.announcement ?? status?.message ?? null}
        tone="neutral"
      />
    </div>
  );
}

function ConnectionFact(input: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {input.label}
      </dt>
      <dd className="mt-1 break-words text-sm text-foreground">
        {input.value}
      </dd>
    </div>
  );
}

function formatVerificationTime(value: string): string {
  const verifiedAt = new Date(value);
  if (Number.isNaN(verifiedAt.getTime())) {
    return "Unavailable";
  }
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(verifiedAt)} UTC`;
}

function readSafeConnectionError(error: unknown, fallback: string): string {
  return error instanceof HostedOnboardingApiError
    ? error.message
    : fallback;
}
