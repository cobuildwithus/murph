import { Link2 } from "lucide-react";
import type { ReactNode } from "react";

import { IntegrationsConnectAuthRequired } from "@/src/components/connected-apps/integrations-connect-auth-required";
import { IntegrationsConnectLauncher } from "@/src/components/connected-apps/integrations-connect-launcher";
import { formatHostedConnectedAppToolkitLabel } from "@/src/lib/connected-apps/config";
import { readHostedConnectedAppIntent } from "@/src/lib/connected-apps/service";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  InvalidRouteParamEncodingError,
  resolveDecodedRouteParam,
} from "@/src/lib/http";
import { cn } from "@/src/lib/utils";

const CONNECT_EYEBROW = "Connected apps";

export default async function IntegrationsConnectPage({
  params,
}: {
  params: Promise<{ claim: string }>;
}) {
  const session = await readConnectSessionOrAuthState();
  if (!session) {
    return <IntegrationsConnectAuthRequired />;
  }

  let claim: string;
  try {
    claim = await resolveDecodedRouteParam(params, "claim");
  } catch (error) {
    if (error instanceof InvalidRouteParamEncodingError) {
      return (
        <ConnectScreen
          title="Connection link unavailable"
          description="This connection link is invalid. Ask Murph for a new one."
        />
      );
    }
    throw error;
  }

  let renderable: ConnectRenderable;
  try {
    renderable = await resolveConnectRenderable({
      claim,
      memberId: session.member.id,
    });
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      return (
        <ConnectScreen
          title="Connection unavailable"
          description={error.message}
        />
      );
    }
    throw error;
  }

  if (renderable.kind === "unavailable") {
    return (
      <ConnectScreen
        title="Connection link unavailable"
        description={renderable.message}
      />
    );
  }

  return (
    <ConnectScreen
      icon={
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card">
          <Link2 className="h-6 w-6 text-primary" aria-hidden="true" />
        </span>
      }
      title={`Connect ${renderable.accountLabel}`}
      description={`Continue to securely connect ${renderable.accountLabel} to Murph.`}
    >
      <IntegrationsConnectLauncher claim={claim} />
    </ConnectScreen>
  );
}

type ConnectRenderable =
  | { kind: "ready"; accountLabel: string }
  | { kind: "unavailable"; message: string };

async function resolveConnectRenderable(input: {
  claim: string;
  memberId: string;
}): Promise<ConnectRenderable> {
  const intent = await readHostedConnectedAppIntent({ claim: input.claim });
  if (intent.memberId !== input.memberId) {
    return {
      kind: "unavailable",
      message:
        "This link is expired, already used, or belongs to another Murph account.",
    };
  }
  if (intent.completedAt || intent.startedAt || intent.expiresAt <= new Date()) {
    return {
      kind: "unavailable",
      message: "This link is expired or already used. Ask Murph for a new one.",
    };
  }
  const label = formatHostedConnectedAppToolkitLabel(intent.toolkit);
  return {
    accountLabel: intent.alias ? `${intent.alias} ${label}` : label,
    kind: "ready",
  };
}

function ConnectScreen({
  children,
  description,
  icon,
  title,
}: {
  children?: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground sm:px-6">
      <section className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center text-center">
        {icon}
        <p
          className={cn(
            "font-mono text-xs uppercase tracking-wide text-muted-foreground",
            icon ? "mt-6" : null,
          )}
        >
          {CONNECT_EYEBROW}
        </p>
        <h1 className="mt-3 font-serif text-3xl leading-tight text-balance break-words sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground text-pretty break-words">
          {description}
        </p>
        {children}
      </section>
    </main>
  );
}

async function readConnectSessionOrAuthState() {
  try {
    return await requireActiveHostedAppSession();
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "AUTH_REQUIRED"
      && error.httpStatus === 401
    ) {
      return null;
    }

    throw error;
  }
}
