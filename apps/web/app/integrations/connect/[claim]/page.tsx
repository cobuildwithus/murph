import { IntegrationsConnectAuthRequired } from "@/src/components/connected-apps/integrations-connect-auth-required";
import {
  IntegrationsConnectLauncher,
  IntegrationsConnectUnavailableScreen,
} from "@/src/components/connected-apps/integrations-connect-launcher";
import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { resolveHostedMurphContactOption } from "@/src/components/murph/hosted-murph-contact-action";
import { formatHostedConnectedAppToolkitLabel } from "@/src/lib/connected-apps/config";
import { readHostedConnectedAppIntent } from "@/src/lib/connected-apps/service";
import { resolveConnectLogoSrc } from "@/src/lib/device-sync/connect-logos";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  InvalidRouteParamEncodingError,
  resolveDecodedRouteParam,
} from "@/src/lib/http";

const LINK_NOT_WORKING_TITLE = "This link isn’t working.";
const ASK_FOR_A_NEW_LINK = "Ask Murph for a new one.";
const NEW_LINK_REPLY_BODY = "Can you send me a new connection link?";

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
      return await renderConnectUnavailable({
        detail: ASK_FOR_A_NEW_LINK,
        title: LINK_NOT_WORKING_TITLE,
      });
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
      return await renderConnectUnavailable({
        detail: error.message,
        title: LINK_NOT_WORKING_TITLE,
      });
    }
    throw error;
  }

  if (renderable.kind === "unavailable") {
    return await renderConnectUnavailable(renderable);
  }

  return (
    <LinkPageFrame>
      <IntegrationsConnectLauncher
        accountLabel={renderable.accountLabel}
        claim={claim}
        logoSrc={renderable.logoSrc}
      />
    </LinkPageFrame>
  );
}

type ConnectRenderable =
  | { kind: "ready"; accountLabel: string; logoSrc: string | null }
  | { detail: string; kind: "unavailable"; title: string };

async function resolveConnectRenderable(input: {
  claim: string;
  memberId: string;
}): Promise<ConnectRenderable> {
  const intent = await readHostedConnectedAppIntent({ claim: input.claim });
  if (intent.memberId !== input.memberId) {
    return {
      detail:
        "This link is expired, already used, or belongs to another Murph account.",
      kind: "unavailable",
      title: LINK_NOT_WORKING_TITLE,
    };
  }
  if (intent.completedAt || intent.startedAt) {
    return {
      detail: `It was already used. ${ASK_FOR_A_NEW_LINK}`,
      kind: "unavailable",
      title: LINK_NOT_WORKING_TITLE,
    };
  }
  if (intent.expiresAt <= new Date()) {
    return {
      detail: `Nothing changed. ${ASK_FOR_A_NEW_LINK}`,
      kind: "unavailable",
      title: "This link expired.",
    };
  }
  const label = formatHostedConnectedAppToolkitLabel(intent.toolkit);
  return {
    accountLabel: intent.alias ? `${intent.alias} ${label}` : label,
    kind: "ready",
    logoSrc: resolveConnectLogoSrc(intent.toolkit),
  };
}

async function renderConnectUnavailable({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  const contactOption = await resolveHostedMurphContactOption({
    message: { body: NEW_LINK_REPLY_BODY },
  }).catch(() => null);

  return (
    <LinkPageFrame>
      <IntegrationsConnectUnavailableScreen
        contactOption={contactOption}
        detail={detail}
        title={title}
      />
    </LinkPageFrame>
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
