import { redirect } from "next/navigation";

import { ComputerHandoffActiveView } from "@/src/components/computer-use/computer-handoff-active-view";
import { ComputerHandoffAuthRequiredState } from "@/src/components/computer-use/computer-handoff-auth-required";
import {
  ComputerHandoffCompletedScreen,
  ComputerHandoffExpiredScreen,
  ComputerHandoffManagedFailedScreen,
  ComputerHandoffManagedRetryScreen,
  ComputerHandoffManagedWaitingScreen,
  ComputerHandoffSavingScreen,
} from "@/src/components/computer-use/computer-handoff-screens";
import {
  LinkPageFrame,
  LinkPageNightGround,
} from "@/src/components/link-page/link-page-shell";
import {
  resolveHostedMurphContactOption,
  resolveHostedMurphContactOptions,
} from "@/src/components/murph/hosted-murph-contact-action";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { requireActiveHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { MurphContactKind, MurphContactOption } from "@/src/lib/murph-contact-routing";

const HANDOFF_DONE_REPLY_BODY = "Done";
const EXPIRED_HANDOFF_REPLY_BODY = "That browser link expired. Please send a new one.";
type HandoffSearchParams = {
  managed?: string | string[];
};

export default async function ComputerHandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<HandoffSearchParams>;
}) {
  const { token } = await params;
  const resolvedSearchParams = await (searchParams ?? Promise.resolve({}));
  const managedState = readManagedHandoffState(resolvedSearchParams);
  const session = await readHandoffSessionOrAuthState();
  if (!session) {
    return <ComputerHandoffAuthRequiredState />;
  }

  const service = createComputerUseService();
  const state = await service.readHandoffPageState({
    memberId: session.member.id,
    token,
  });

  const managedEndpoint =
    `/api/computer/handoff/${encodeURIComponent(token)}/managed-login`;

  if (state.kind === "managed_login") {
    if (managedState !== "retry" && managedState !== "waiting") {
      redirect(managedEndpoint);
    }
    return (
      <LinkPageFrame>
        {managedState === "retry" ? (
          <ComputerHandoffManagedRetryScreen href={managedEndpoint} />
        ) : (
          <ComputerHandoffManagedWaitingScreen href={managedEndpoint} />
        )}
      </LinkPageFrame>
    );
  }

  if (
    state.kind === "checkpointing" &&
    state.purpose === "managed_login" &&
    managedState === "retry"
  ) {
    return (
      <LinkPageFrame>
        <ComputerHandoffManagedFailedScreen />
      </LinkPageFrame>
    );
  }

  if (state.kind === "checkpointing") {
    return (
      <LinkPageFrame>
        <ComputerHandoffSavingScreen />
      </LinkPageFrame>
    );
  }

  if (state.kind === "expired") {
    const contactOption = await resolveHostedMurphContactOption({
      message: { body: EXPIRED_HANDOFF_REPLY_BODY },
      preferredKind: state.returnContactKind,
    }).catch(() => null);

    return (
      <LinkPageFrame>
        <ComputerHandoffExpiredScreen contactOption={contactOption} />
      </LinkPageFrame>
    );
  }

  if (state.kind === "completed") {
    const emailReturn = state.returnContactKind === "email";
    const contactOptions = emailReturn
      ? []
      : await resolveCompletedHandoffContactOptions(state.returnContactKind);

    return (
      <LinkPageFrame>
        <ComputerHandoffCompletedScreen
          contactOptions={contactOptions}
          emailReturn={emailReturn}
        />
      </LinkPageFrame>
    );
  }

  const encodedToken = encodeURIComponent(token);
  const doneEndpoint = `/api/computer/handoff/${encodedToken}/done`;

  return (
    <main className="relative min-h-dvh bg-[#1C1915]">
      <LinkPageNightGround />
      <ComputerHandoffActiveView
        doneEndpoint={doneEndpoint}
        iframeAllow={state.iframeAllow}
        liveViewUrl={state.liveViewUrl}
      />
    </main>
  );
}

function readManagedHandoffState(
  searchParams: HandoffSearchParams,
): "retry" | "waiting" | null {
  const value = Array.isArray(searchParams.managed)
    ? searchParams.managed[0]
    : searchParams.managed;
  return value === "retry" ||
      value === "waiting"
    ? value
    : null;
}

async function readHandoffSessionOrAuthState() {
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

async function resolveCompletedHandoffContactOptions(
  returnContactKind: MurphContactKind | null,
): Promise<MurphContactOption[]> {
  let options: MurphContactOption[];
  try {
    options = await resolveHostedMurphContactOptions({
      message: { body: HANDOFF_DONE_REPLY_BODY },
      preferredKind: returnContactKind,
    });
  } catch {
    return [];
  }
  return returnContactKind
    ? options.filter((option) => option.kind === returnContactKind)
    : options;
}
