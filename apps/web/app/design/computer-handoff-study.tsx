"use client";

import {
  ComputerHandoffDoneScreen,
  ComputerHandoffIsland,
  ComputerHandoffTakeoverScreen,
} from "@/src/components/computer-use/computer-handoff-active-view";
import {
  ComputerHandoffCompletedScreen,
  ComputerHandoffExpiredScreen,
  ComputerHandoffManagedFailedScreen,
  ComputerHandoffManagedRetryScreen,
  ComputerHandoffManagedWaitingScreen,
  ComputerHandoffSavingScreen,
} from "@/src/components/computer-use/computer-handoff-screens";
import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";

import { LinkPageStudyState } from "./link-page-study-state";

const STUDY_CONTACT = {
  href: "sms:+15550100000",
  kind: "text",
  label: "Messages",
} as const;

export function ComputerHandoffStudy() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3"
      data-design-section="computer-handoff"
      id="computer-handoff"
    >
      <LinkPageStudyState label="Signed out">
        <AuthProvider authenticated={false}>
          <LinkPageSignInScreen
            detail="This link is private to your Murph account."
            title="Sign in to finish this step."
          />
        </AuthProvider>
      </LinkPageStudyState>
      <LinkPageStudyState label="Your turn">
        <ComputerHandoffTakeoverScreen />
      </LinkPageStudyState>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          In the browser
        </p>
        <div
          className="relative flex min-h-[46rem] flex-col justify-end overflow-hidden rounded-[2rem] bg-white p-4"
          inert
        >
          <div className="flex justify-center">
            <ComputerHandoffIsland keepInViewport={false} persistKey={null} />
          </div>
        </div>
      </div>
      <LinkPageStudyState label="Saving">
        <ComputerHandoffSavingScreen />
      </LinkPageStudyState>
      <LinkPageStudyState label="All set, on the way back">
        <ComputerHandoffDoneScreen redirectTo="sms:+15550100000" />
      </LinkPageStudyState>
      <LinkPageStudyState label="All set">
        <ComputerHandoffCompletedScreen contactOptions={[STUDY_CONTACT]} emailReturn={false} />
      </LinkPageStudyState>
      <LinkPageStudyState label="All set, email">
        <ComputerHandoffCompletedScreen contactOptions={[]} emailReturn />
      </LinkPageStudyState>
      <LinkPageStudyState label="All set, no way to reply">
        <ComputerHandoffCompletedScreen contactOptions={[]} emailReturn={false} />
      </LinkPageStudyState>
      <LinkPageStudyState label="Finishing sign-in">
        <ComputerHandoffManagedWaitingScreen href="#computer-handoff" />
      </LinkPageStudyState>
      <LinkPageStudyState label="Sign-in can be retried">
        <ComputerHandoffManagedRetryScreen href="#computer-handoff" />
      </LinkPageStudyState>
      <LinkPageStudyState label="Sign-in failed">
        <ComputerHandoffManagedFailedScreen />
      </LinkPageStudyState>
      <LinkPageStudyState label="Expired">
        <ComputerHandoffExpiredScreen contactOption={STUDY_CONTACT} />
      </LinkPageStudyState>
    </div>
  );
}
