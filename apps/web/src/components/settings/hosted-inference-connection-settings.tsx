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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Spinner } from "@/src/components/ui/spinner";
import type {
  HostedInferenceConnectionView,
} from "@/src/lib/hosted-inference/types";

import { SettingsStatusLine } from "./connected-account-card";

const HOSTED_INFERENCE_CONNECTION_URL =
  "/api/settings/inference-connection";
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

interface HostedInferenceConnectionPaneProps {
  chatCompletionsAvailable: boolean;
  configurationAvailable: boolean;
  connection: HostedInferenceConnectionView | null;
  onConnectionChange: (connection: HostedInferenceConnectionView | null) => void;
  selected: boolean;
}

interface ConnectionMutationResponse {
  connection: HostedInferenceConnectionView;
}

/**
 * Endpoint pane of the provider dialog: verify, replace, and delete the one
 * personal connection. Selecting it for inference is the dialog's job, so a
 * successful verification here deliberately leaves the connection inactive.
 */
export function HostedInferenceConnectionPane(
  props: HostedInferenceConnectionPaneProps,
) {
  const { connection } = props;
  const [editing, setEditing] = useState(connection === null);
  const [protocol, setProtocol] = useState<HostedInferenceProtocol>(
    connection?.protocol ?? "responses",
  );
  const [endpointUrl, setEndpointUrl] = useState("");
  const [model, setModel] = useState(connection?.model ?? "");
  const [authKind, setAuthKind] = useState<HostedInferenceAuthKind>("bearer");
  const [secret, setSecret] = useState("");
  const [contextWindowTokens, setContextWindowTokens] = useState(
    String(connection?.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS),
  );
  const [supportsImages, setSupportsImages] = useState(
    connection?.supportsImages ?? false,
  );
  const [pendingAction, setPendingAction] = useState<
    "connection" | "delete" | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<{
    announcement?: string;
    message: string;
    tone: "destructive" | "neutral";
  } | null>(null);
  const confirmDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const connectionHeadingRef = useRef<HTMLParagraphElement>(null);
  const deleteConnectionButtonRef = useRef<HTMLButtonElement>(null);
  const protocolTriggerRef = useRef<HTMLButtonElement>(null);
  const replaceButtonRef = useRef<HTMLButtonElement>(null);
  const disabled = pendingAction !== null || !props.configurationAvailable;

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
      props.onConnectionChange(response.connection);
      setEndpointUrl("");
      setSecret("");
      setEditing(false);
      setConfirmDelete(false);
      setStatus({
        message:
          "Verified and saved. Choose Your endpoint and save to route inference to it.",
        tone: "neutral",
      });
      requestAnimationFrame(() => connectionHeadingRef.current?.focus());
    } catch (error) {
      setStatus({
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
      props.onConnectionChange(null);
      setEditing(true);
      setConfirmDelete(false);
      setModel("");
      setEndpointUrl("");
      setSecret("");
      setStatus({
        announcement:
          "Connection deleted. Inference is now Murph-managed.",
        message: "Connection deleted.",
        tone: "neutral",
      });
      requestAnimationFrame(() => connectionHeadingRef.current?.focus());
    } catch (error) {
      setStatus({
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
    <div className="flex flex-col gap-5">
      <p
        className="max-w-[46ch] rounded-sm text-sm/6 text-pretty text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        ref={connectionHeadingRef}
        tabIndex={-1}
      >
        Murph sends relevant conversation context, tool descriptions, and
        supported attachments to this endpoint. The credential is encrypted and
        is never placed in the assistant runner.
      </p>

      {!props.configurationAvailable ? (
        <p className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-pretty text-muted-foreground">
          Endpoint choices are read-only until personal Murph access is active.
        </p>
      ) : null}

      {connection && !editing ? (
        <>
          <dl className="grid gap-x-6 gap-y-4 border-y border-border py-5 sm:grid-cols-2">
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
              value={props.selected ? "In use" : "Verified, inactive"}
            />
          </dl>
          <div className="flex flex-wrap items-center gap-2">
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
            {confirmDelete ? (
              <>
                <span
                  className="mr-1 text-sm text-muted-foreground"
                  id="hosted-inference-delete-description"
                >
                  {props.selected
                    ? "Delete the saved endpoint and credential? Inference will return to your managed provider."
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
        </>
      ) : (
        <form
          aria-busy={pendingAction === "connection"}
          className="flex flex-col gap-5"
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
            <Field orientation="horizontal">
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

      {status ? (
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
