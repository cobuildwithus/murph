import {
  IntegrationsConnectLauncherView,
  IntegrationsConnectUnavailableScreen,
} from "@/src/components/connected-apps/integrations-connect-launcher";
import { LinkPageFailureScreen } from "@/src/components/link-page/link-page-failure";

import { LinkPageStudyState } from "./link-page-study-state";

const launcherStates = [
  { autoContinueEnabled: true, label: "Ready", state: "waiting" },
  { autoContinueEnabled: false, label: "Paused", state: "waiting" },
  { autoContinueEnabled: true, label: "Connecting", state: "connecting" },
  { autoContinueEnabled: true, label: "Didn’t start", state: "failed" },
] as const;

const STUDY_CONTACT = {
  href: "sms:+15550100000",
  kind: "text",
  label: "Messages",
} as const;

export function ConnectedAppAuthorizationStudy() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3"
      data-design-section="connected-app-authorization-handoff"
      id="connected-app-authorization-handoff"
    >
      {launcherStates.map(({ autoContinueEnabled, label, state }) => (
        <LinkPageStudyState key={label} label={label}>
          <IntegrationsConnectLauncherView
            accountLabel="Gmail"
            autoContinueEnabled={autoContinueEnabled}
            logoSrc="/brand-logos/connect/gmail.svg"
            state={state}
          />
        </LinkPageStudyState>
      ))}
      <LinkPageStudyState label="No logo on file">
        <IntegrationsConnectLauncherView
          accountLabel="Outlook"
          autoContinueEnabled
          logoSrc={null}
          state="waiting"
        />
      </LinkPageStudyState>
      <LinkPageStudyState label="Link doesn’t work">
        <IntegrationsConnectUnavailableScreen
          contactOption={STUDY_CONTACT}
          detail="Ask Murph for a new one."
          title="This link isn’t working."
        />
      </LinkPageStudyState>
      <LinkPageStudyState label="Link expired">
        <IntegrationsConnectUnavailableScreen
          contactOption={STUDY_CONTACT}
          detail="Nothing changed. Ask Murph for a new one."
          title="This link expired."
        />
      </LinkPageStudyState>
      <LinkPageStudyState label="Another account">
        <IntegrationsConnectUnavailableScreen
          contactOption={STUDY_CONTACT}
          detail="This link is expired, already used, or belongs to another Murph account."
          title="This link isn’t working."
        />
      </LinkPageStudyState>
      <LinkPageStudyState label="Something broke">
        <LinkPageFailureScreen />
      </LinkPageStudyState>
    </div>
  );
}
