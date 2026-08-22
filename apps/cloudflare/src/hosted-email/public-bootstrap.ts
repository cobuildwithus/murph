import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import { readRawEmailHeaderValue } from "@murphai/inboxd/connectors/email/parsed";
import {
  resolveHostedEmailBootstrapCandidateAddress,
} from "@murphai/runtime-state";

import type { readHostedExecutionEnvironment } from "../env.ts";
import {
  readHostedEmailHeaderBytes,
  type HostedEmailWorkerRequest,
} from "../hosted-email.ts";
import { requestHostedEmailPublicBootstrapInWeb } from "../web-control-plane-email-bootstrap.ts";

export async function handleHostedEmailPublicBootstrap(input: {
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  fetchImpl?: typeof fetch;
  message: HostedEmailWorkerRequest;
}): Promise<void> {
  try {
    const headerBytes = await readHostedEmailHeaderBytes(input.message.raw);
    if (!headerBytes) {
      emitPublicBootstrapLog("header-invalid", "checkpoint");
      return;
    }

    const headerFrom = readRawEmailHeaderValue(headerBytes, "from");
    const candidateAddress = resolveHostedEmailBootstrapCandidateAddress({
      envelopeFrom: input.message.from,
      hasRepeatedHeaderFrom: headerFrom.repeated,
      headerFrom: headerFrom.value,
    });
    if (!candidateAddress) {
      emitPublicBootstrapLog("sender-filter-miss", "checkpoint");
      return;
    }

    await requestHostedEmailPublicBootstrapInWeb({
      ...(input.environment.hostedWebAllowHttpHosts
        ? { allowHttpHosts: input.environment.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: input.environment.hostedWebBaseUrl,
      body: { candidateAddress },
      callbackSigning: input.environment.webCallbackSigning,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.environment.webControlTimeoutMs,
    });
    emitPublicBootstrapLog("callback-complete", "checkpoint");
  } catch {
    // Public-address input is always accepted and dropped. The callback is a
    // fixed-principal, one-way bootstrap hint; no lookup or provider outcome is
    // reflected to the SMTP sender or included in logs.
    emitPublicBootstrapLog("callback-failed", "failed");
  }
}

function emitPublicBootstrapLog(
  reason: string,
  phase: "checkpoint" | "failed",
): void {
  emitHostedExecutionStructuredLog({
    component: "hosted.email",
    details: { reason },
    level: phase === "checkpoint" ? "info" : "warn",
    message: "Hosted public email bootstrap finished.",
    phase,
  });
}
