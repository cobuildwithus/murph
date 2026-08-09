"use client";

import {
  HOSTED_ASSISTANT_OPENAI_PROVIDER,
} from "@murphai/hosted-execution/assistant-model";
import { useState } from "react";
import { CheckCircle2, CheckIcon, ContactRound, Monitor } from "lucide-react";
import { SourceCard } from "@/app/(dashboard)/connect/connect-source-card";
import type { ConnectSource } from "@/app/(dashboard)/connect/connect-page-types";
import {
  DeviceSyncCompletionDialog,
  DeviceSyncSetupGuideDialog,
} from "@/app/(dashboard)/home/device-sync-completion-dialog";
import { ComputerHandoffFloatingIsland } from "@/src/components/computer-use/computer-handoff-floating-island";
import { HomeExperimentCard } from "@/src/components/home/home-experiment-card";
import {
  GroupUsageFundingActions,
  GroupUsageFundingShell,
} from "@/src/components/hosted-groups/group-usage-funding-shell";
import { GroupSponsorshipDialog } from "@/src/components/hosted-groups/group-sponsorship-dialog";
import { GroupSponsorshipManagementCard } from "@/src/components/hosted-groups/group-sponsorship-management-card";
import { MetricCard } from "@/src/components/ui/metric-card";
import { TimelineEntry } from "@/src/components/ui/timeline-entry";
import { ConclusionCard } from "@/src/components/conclusion-card";
import { NextStepCard } from "@/src/components/next-step-card";
import { ExpectedSignalCard } from "@/src/components/experiments/experiment-detail/expected-signal-card";
import { StartExperimentChannelDialog } from "@/src/components/experiments/experiment-detail/start-experiment-button";
import {
  HostedEmailMurphContactDialog,
  WebmailIcon,
} from "@/src/components/settings/hosted-email-murph-contact-dialog";
import {
  HostedPhonePrivyHandOffStatus,
  HostedPhoneLinkAction,
  HostedPhoneLinkCardPresentation,
} from "@/src/components/settings/hosted-phone-settings";
import {
  HostedIdentitySessionLoading,
  HostedIdentitySessionMismatch,
} from "@/src/components/settings/hosted-settings-identity-link-dialog";
import {
  ASSISTANT_MODEL_CHOICE_CARD_CLASSES,
  AssistantModelArtwork,
} from "@/src/components/settings/assistant-model-artwork";
import {
  AssistantProviderDialog,
  AssistantProviderSummary,
  type AssistantRoutingChoice,
} from "@/src/components/settings/hosted-assistant-model-settings";
import { HostedInferenceConnectionPane } from "@/src/components/settings/hosted-inference-connection-settings";
import { DESIGN_INFERENCE_CONNECTION } from "./design-inference-connection";
import { HealthDomainCard } from "@/src/components/overview/health-domain-card";
import { ActiveExperimentBanner } from "@/src/components/overview/active-experiment-banner";
import { TrialBillingBanner } from "@/src/components/home/trial-billing-banner";
import { ProfileStats } from "@/src/components/overview/profile-stats";
import {
  HostedAuthPanelAlternateMethods,
  HostedResumableAuthState,
} from "@/src/components/hosted-onboarding/hosted-auth-panel";
import { HostedPrivyReadinessState } from "@/src/components/hosted-onboarding/hosted-auth-panel-island";
import { EmailIcon } from "@/src/components/homepage/email-icon";
import {
  resolveAuthDialogHeaderPresentation,
} from "@/src/components/hosted-onboarding/auth-dialog";
import { HostedInlineAuthButton } from "@/src/components/hosted-onboarding/hosted-inline-auth-button";
import { HostedCodeEntryStep } from "@/src/components/hosted-onboarding/hosted-phone-auth-step-views";
import { HostedAuthenticatedPhoneAuthState } from "@/src/components/hosted-onboarding/hosted-phone-auth-views";
import { HostedContactChannelChoice } from "@/src/components/hosted-onboarding/hosted-contact-channel-choice";
import { HostedTelegramAuthButtonPresentation } from "@/src/components/hosted-onboarding/hosted-telegram-auth-button";
import {
  HostedLegalConsentCard,
  type HostedLegalConsentAcceptanceInput,
} from "@/src/components/legal/hosted-legal-consent-card";
import { HOSTED_PHONE_COUNTRY_OPTIONS } from "@/src/components/hosted-onboarding/hosted-phone-country-options";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import { AuthButton } from "@/src/components/ui/auth-button";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { ChoiceCard } from "@/src/components/ui/choice-card";
import { PaymentButton } from "@/src/components/ui/payment-button";
import { Badge } from "@/src/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Progress } from "@/src/components/ui/progress";
import { Separator } from "@/src/components/ui/separator";
import { Input } from "@/src/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/src/components/ui/field";
import { Textarea } from "@/src/components/ui/textarea";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/src/components/ui/input-otp";
import { Label } from "@/src/components/ui/label";
import { PhoneNumberInput } from "@/src/components/ui/phone-number-input";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { Alert, AlertTitle, AlertDescription } from "@/src/components/ui/alert";
import { Toggle } from "@/src/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";
import { RadioGroup } from "@/src/components/ui/radio-group";
import { Spinner } from "@/src/components/ui/spinner";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "@/src/components/ui/segmented-control";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/src/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/src/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/src/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/src/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/src/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { PlanVisual } from "@/src/components/ui/plan-visual";
import {
  IN_APP_BROWSER_DESCRIPTION,
  IN_APP_BROWSER_PRIMARY_ACTION,
  MURPH_CONTACT_AVATAR_OPTIONS,
  MurphContactAvatarArt,
  MurphContactAvatarGrid,
  MurphContactCardPicker,
  type MurphContactAvatarOption,
} from "@/src/components/murph/murph-contact-card-picker";
import type { ExperimentStartContactOption } from "@/src/lib/experiments/start-experiment-contact";
import type { ExperimentLibraryCard } from "@/src/lib/experiments/library-cards";
import type { DeviceSyncCompletionDialogModel } from "@/src/lib/device-sync/connect-completion-types";
import type { HostedConsentStatus } from "@/src/lib/legal/consent";
import { buildWhoopAppleHealthSetupGuide } from "@/src/lib/device-sync/whoop-apple-health-setup-guide";
import {
  CHECKOUT_CORE_FEATURES,
  CHECKOUT_PULSE_FEATURES,
  EDGE_ONLY_FEATURES,
  JOIN_EDGE_FEATURES,
  JOIN_FAMILY_FEATURES,
  JOIN_PULSE_FEATURES,
  PULSE_TRIAL_FEATURES,
  SETTINGS_CORE_FEATURES,
  SETTINGS_EDGE_FEATURES,
  SETTINGS_FAMILY_FEATURES,
  SETTINGS_PULSE_FEATURES,
} from "@/src/lib/hosted-onboarding/plan-features";
import { MurphAssistantStylePicker } from "@/src/components/murph/murph-assistant-style-picker";
import { HostedAiUsageActivity } from "@/src/components/settings/hosted-ai-usage-activity";
import { HostedFamilyManager } from "@/src/components/settings/hosted-family-settings-actions";
import { HostedPlanChangeConfirmationContent } from "@/src/components/settings/hosted-plan-change-button";
import { UpgradeToEdgeButton } from "@/src/components/settings/hosted-plan-upgrade-button";
import { HostedPlanUpdateReturn } from "@/src/components/settings/hosted-plan-update-return";
import { PulseTrialBillingContinuationView } from "@/src/components/settings/hosted-start-paid-pulse-button";
import { MurphPersonalitySettingsDialog } from "@/src/components/settings/murph-personality-settings-dialog";
import {
  DESIGN_AI_USAGE_ACTIVITY,
  DESIGN_AI_USAGE_DISABLED_HISTORY,
  DESIGN_AI_USAGE_EMPTY_ACTIVITY,
  DESIGN_AI_USAGE_WAITING_ACTIVITY,
  DESIGN_GROUP_MONTHLY_CAPS,
  DESIGN_GROUP_SPONSORSHIP_OFFERS,
  DESIGN_USAGE_OFFERS,
  DESIGN_USAGE_MISSION_CONTACT_OPTION,
} from "./group-usage-funding-study";
import { HostedUsageTopUpDialog } from "@/src/components/settings/hosted-usage-top-up-dialog";
import { ConnectCallbackErrorNotice } from "@/src/components/device-sync/connect-callback-error-notice";
import { HostedAccountDeletionStatus } from "@/src/components/settings/hosted-data-privacy-settings";
import { VitalConnectionDialog } from "../(dashboard)/connect/connect-page-dialogs";
import {
  EnvironmentCaptureCard,
  EnvironmentEmptyState,
  EnvironmentVoiceRefreshNotice,
} from "../(dashboard)/environment/environment-page-client";
import type { EnvironmentVoiceScript } from "../(dashboard)/environment/environment-voice-script";
import { ExperimentResultsShareStudy } from "./experiment-results-share-study";
import { DataExportControlStudy } from "./data-export-study";
import { HealthDataConsentControlStudy } from "./health-data-consent-study";
import { SignupReferralComponentStudy } from "./signup-referral-study";

const DESIGN_SIGNED_GROUP_FUNDING_ENDPOINT =
  "/api/groups/fund/gf1.design_group_runtime.synthetic_funding_signature";

const DESIGN_ENVIRONMENT_GAP_SCRIPT: EnvironmentVoiceScript = {
  dialogTitle: "Fill the gaps in your report",
  flow: "fill-gaps",
  idleDescription:
    "Two short topics, based on what Murph does not know yet.",
  idleTitle: "Only the missing details",
  topics: [
    {
      eyebrow: "Sleep",
      focus: ["Bedroom CO₂"],
      id: "sleep",
      prompt:
        "Cover only the details Murph is still missing. If something does not apply or you would rather skip it, say so.",
      title: "Your sleep setup",
    },
    {
      eyebrow: "Workspace",
      focus: ["Breaks"],
      id: "workspace",
      prompt:
        "Cover only the details Murph is still missing. If something does not apply or you would rather skip it, say so.",
      title: "Your remaining workspace details",
    },
  ],
};

function Section({
  children,
  id,
  title,
}: {
  children: React.ReactNode;
  id?: string;
  title: string;
}) {
  return (
    <div id={id} className="flex flex-col gap-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function PlanBulletListStudy({
  features,
  title,
}: {
  features: readonly string[];
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4">
      <p className="mb-2 text-sm font-medium text-foreground">{title}</p>
      <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <CheckIcon
              className="mt-0.5 size-3.5 shrink-0 text-primary"
              strokeWidth={2.5}
              aria-hidden="true"
            />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DialogPreviewFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div className="max-w-md rounded-2xl bg-[#FAF8F4] p-6 shadow-[0_1px_2px_rgba(26,31,22,0.04)] ring-1 ring-[#1A1F16]/[0.06] md:p-7">
        <DialogPreviewHeader />
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function DialogPreviewHeader() {
  const header = resolveAuthDialogHeaderPresentation({
    panelView: "auth-active",
  });

  return (
    <div className={header.headerClassName}>
      <h3 className="text-xl font-bold tracking-tight text-foreground">
        {header.title}
      </h3>
      <p className="text-sm text-pretty text-muted-foreground">
        {header.description}
      </p>
    </div>
  );
}

function resolveDesignPhoneCountryOption(value: string) {
  const option =
    HOSTED_PHONE_COUNTRY_OPTIONS.find((candidate) => candidate.code === value)
    ?? HOSTED_PHONE_COUNTRY_OPTIONS.find((candidate) => candidate.code === "US")
    ?? HOSTED_PHONE_COUNTRY_OPTIONS[0];
  if (!option) {
    throw new Error("Phone country options are empty.");
  }
  return option;
}


const EXPERIMENT_START_CHANNEL_OPTIONS: ExperimentStartContactOption[] = [
  {
    connected: true,
    description: "Preview a prepared Messages draft.",
    href: "#experiment-start-channel-picker-study",
    kind: "text",
    label: "Messages",
  },
  {
    connected: true,
    description: "Preview a prepared Telegram draft.",
    href: "#experiment-start-channel-picker-study",
    kind: "telegram",
    label: "Telegram",
  },
  {
    connected: true,
    description: "Preview a prepared email draft.",
    href: "#experiment-start-channel-picker-study",
    kind: "email",
    label: "Email",
  },
];

const WHOOP_COMPLETION_SETUP_GUIDE = buildWhoopAppleHealthSetupGuide(
  "/audio/whoop-sync-memos/grandpa.mp3",
);

const WHOOP_COMPLETION_DIALOG_MODEL: DeviceSyncCompletionDialogModel = {
  contactAction: {
    href: "sms:?body=I%20just%20connected%20my%20WHOOP",
    kind: "imessage",
    label: "Text Murph",
  },
  detail:
    "Heads up: WHOOP doesn't share all of your data automatically. Syncing through Apple Health gives Murph the complete picture.",
  failed: false,
  kind: "device-sync",
  retryHref: null,
  setupGuide: WHOOP_COMPLETION_SETUP_GUIDE,
  title: "WHOOP is connected",
  unverified: false,
};

type SegmentedControlDemoValue = "phone" | "email" | "telegram";

const DESIGN_LEGAL_DOCUMENTS: HostedConsentStatus["documents"] = [
  {
    href: "/legal/terms",
    id: "terms-of-service",
    pdfHref: "/legal/terms.pdf",
    title: "Murph Terms of Service",
    version: "2026-07-23",
  },
  {
    href: "/legal/privacy",
    id: "privacy-policy",
    pdfHref: "/legal/privacy.pdf",
    title: "Murph Privacy Policy",
    version: "2026-07-23",
  },
  {
    href: "/legal/health-ai-safety-disclosure",
    id: "health-ai-safety-disclosure",
    pdfHref: "/legal/health-ai-safety-disclosure.pdf",
    title: "Murph Health AI Safety Disclosure",
    version: "2026-07-23",
  },
  {
    href: "/consumer-health-data-privacy-policy",
    id: "consumer-health-data-notice",
    pdfHref: "/legal/consumer-health-data-notice.pdf",
    title: "Murph Consumer Health Data Notice",
    version: "2026-07-23",
  },
];

const DESIGN_LEGAL_SCOPE_DOCUMENTS = DESIGN_LEGAL_DOCUMENTS.slice(0, 3);
const DESIGN_HEALTH_DATA_SCOPE_DOCUMENTS = DESIGN_LEGAL_DOCUMENTS.slice(3);
const DESIGN_AVAILABLE_CONNECT_SOURCES: ConnectSource[] = [
  {
    connectProvider: "oura",
    connectTarget: "oura",
    description: "Smart ring. Sleep, readiness, temperature, and recovery.",
    id: "oura",
    logo: {
      className: "h-auto max-h-8 w-auto max-w-[8rem] object-contain",
      height: 30,
      src: "/brand-logos/connect/oura.png",
      width: 96,
    },
    name: "Oura",
  },
  {
    connectProvider: "junction",
    connectTarget: "junction:garmin",
    description: "Workouts, sleep, stress, heart rate, and body battery.",
    id: "garmin",
    logo: {
      className: "size-11 object-contain",
      height: 44,
      src: "/brand-logos/connect/garmin.png",
      width: 44,
    },
    name: "Garmin",
  },
];
function createDesignLaunchConsentStatus({
  healthDataGranted,
  legalGranted,
}: {
  healthDataGranted: boolean;
  legalGranted: boolean;
}): HostedConsentStatus {
  return {
    documents: DESIGN_LEGAL_DOCUMENTS,
    generatedAt: "2026-07-23T12:00:00.000Z",
    launchGranted: legalGranted && healthDataGranted,
    launchScopes: [
      {
        granted: legalGranted,
        missingDocuments: legalGranted ? [] : DESIGN_LEGAL_SCOPE_DOCUMENTS,
        scope: "launch.legal",
      },
      {
        granted: healthDataGranted,
        missingDocuments: healthDataGranted
          ? []
          : DESIGN_HEALTH_DATA_SCOPE_DOCUMENTS,
        scope: "launch.health-data",
      },
    ],
    ok: true,
    schema: "murph.hosted-consent-status.v1",
    scopes: [
      {
        current: legalGranted,
        documents: DESIGN_LEGAL_SCOPE_DOCUMENTS,
        grant: null,
        granted: legalGranted,
        label: "Terms, privacy, and AI disclosure",
        missingDocuments: legalGranted ? [] : DESIGN_LEGAL_SCOPE_DOCUMENTS,
        revocable: false,
        scope: "launch.legal",
      },
      {
        current: healthDataGranted,
        documents: DESIGN_HEALTH_DATA_SCOPE_DOCUMENTS,
        grant: null,
        granted: healthDataGranted,
        label: "Health data notice and processing authorization",
        missingDocuments: healthDataGranted
          ? []
          : DESIGN_HEALTH_DATA_SCOPE_DOCUMENTS,
        revocable: false,
        scope: "launch.health-data",
      },
    ],
  };
}

const DESIGN_DASHBOARD_CONSENT_STATUS = createDesignLaunchConsentStatus({
  healthDataGranted: false,
  legalGranted: false,
});
const DESIGN_LEGAL_ONLY_CONSENT_STATUS = createDesignLaunchConsentStatus({
  healthDataGranted: true,
  legalGranted: false,
});
const DESIGN_HEALTH_DATA_ONLY_CONSENT_STATUS = createDesignLaunchConsentStatus({
  healthDataGranted: false,
  legalGranted: true,
});

const SEGMENTED_CONTROL_OPTIONS: ReadonlyArray<
  SegmentedControlOption<SegmentedControlDemoValue>
> = [
  { label: "Phone", value: "phone" },
  { label: "Email", value: "email" },
  { label: "Telegram", value: "telegram" },
];

const DESIGN_HOME_HISTORY_CARDS: ExperimentLibraryCard[] = [
  {
    category: "Nutrition",
    description: "Synthetic completed run for component review.",
    hasPrivateData: true,
    href: "/design",
    id: "design-earlier-evening-meals",
    image: "/design-assets/hero-01.png",
    privateBadgeLabel: "Private data",
    runStatus: "finished",
    runSummary: {
      completionPercent: 100,
      dateRange: "Jun 2 – Jun 22",
      day: 21,
      metrics: [
        {
          current: "54.7 bpm",
          delta: "-2.1 bpm",
          label: "Resting heart rate",
          sentiment: "positive",
        },
        {
          current: "93.8 percent",
          delta: "+1.4 percent",
          label: "Sleep efficiency",
          sentiment: "positive",
        },
      ],
    },
    searchText: "design earlier evening meals",
    startedOn: "2026-06-02",
    statusLabel: "Completed",
    statusVariant: "outline",
    title: "Earlier Evening Meals",
  },
  {
    category: "Recovery",
    description: "Synthetic completed run for component review.",
    hasPrivateData: true,
    href: "/design",
    id: "design-consistent-wake-time",
    image: "/design-assets/hero-02.png",
    privateBadgeLabel: "Private data",
    runStatus: "finished",
    runSummary: {
      completionPercent: 100,
      dateRange: "May 8 – May 28",
      day: 21,
      metrics: [
        {
          current: "91.3 percent",
          delta: "+2.3 percent",
          label: "Sleep efficiency",
          sentiment: "positive",
        },
        {
          current: "105 min",
          delta: "+14 min",
          label: "Deep sleep",
          sentiment: "positive",
        },
        {
          current: "57.9 ms",
          delta: "+0.8 ms",
          label: "HRV RMSSD",
          sentiment: "neutral",
        },
        {
          current: "57 min",
          delta: "+9 min",
          label: "Sleep latency",
          sentiment: "negative",
        },
      ],
    },
    searchText: "design consistent wake time",
    startedOn: "2026-05-08",
    statusLabel: "Completed",
    statusVariant: "outline",
    title: "Consistent Wake Time",
  },
  {
    category: "Movement",
    description: "Synthetic completed run for component review.",
    hasPrivateData: true,
    href: "/design",
    id: "design-easy-aerobic-base",
    image: "/design-assets/hero-03.png",
    privateBadgeLabel: "Private data",
    runStatus: "finished",
    runSummary: {
      completionPercent: 100,
      dateRange: "Apr 12 – May 3",
      day: 22,
      metrics: [
        {
          current: "49.8 bpm",
          delta: "-3.2 bpm",
          label: "Resting heart rate",
          sentiment: "positive",
        },
        {
          current: "61.4 ms",
          delta: "+4.6 ms",
          label: "HRV RMSSD",
          sentiment: "positive",
        },
        {
          current: "89.1 percent",
          delta: "-0.5 percent",
          label: "Blood oxygen saturation (SpO₂)",
          sentiment: "negative",
        },
      ],
    },
    searchText: "design easy aerobic base",
    startedOn: "2026-04-12",
    statusLabel: "Completed",
    statusVariant: "outline",
    title: "Easy Aerobic Base",
  },
];

export function ComponentsContent() {
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [contactCardPickerOpen, setContactCardPickerOpen] = useState(false);
  const [personalitySettingsOpen, setPersonalitySettingsOpen] = useState(false);
  const [vitalConnectionDialogSource, setVitalConnectionDialogSource] = useState<
    Pick<ConnectSource, "id" | "logo" | "name" | "requiresReconnect"> | null
  >(null);
  const [assistantStylePickerStep, setAssistantStylePickerStep] =
    useState<"tone" | "voice" | null>(null);
  const [segmentedControlValue, setSegmentedControlValue] =
    useState<SegmentedControlDemoValue>("phone");
  const [warmSegmentedControlValue, setWarmSegmentedControlValue] =
    useState<SegmentedControlDemoValue>("email");
  const [choiceCardValue, setChoiceCardValue] = useState("terra");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerValue, setProviderValue] = useState<AssistantRoutingChoice>(
    HOSTED_ASSISTANT_OPENAI_PROVIDER,
  );
  const [addedContactAvatar, setAddedContactAvatar] =
    useState<MurphContactAvatarOption | null>(null);
  const [inlineContactAvatarId, setInlineContactAvatarId] = useState("hooded");
  const [phoneInputCountryCode, setPhoneInputCountryCode] = useState("US");
  const [phoneInputValue, setPhoneInputValue] = useState("");
  const [phoneTransferSupportDialogOpen, setPhoneTransferSupportDialogOpen] =
    useState(false);
  const [whoopCompletionPreviewKey, setWhoopCompletionPreviewKey] = useState(0);
  const [whoopCapacityPreviewOpen, setWhoopCapacityPreviewOpen] = useState(false);
  const [whoopCapacityNoContactPreviewOpen, setWhoopCapacityNoContactPreviewOpen] =
    useState(false);
  const selectedPhoneInputCountry = resolveDesignPhoneCountryOption(phoneInputCountryCode);

  return (
    <TooltipProvider>
      <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-12 sm:px-10 lg:px-16">
        <div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">Components</h1>
          <p className="mt-2 text-sm text-muted-foreground">Shadcn base UI + custom Murph components. Colors and typography live in the Brand tab.</p>
        </div>

        <Separator />

        <Section title="Home experiment history cards">
          <div
            className="grid items-start gap-5 lg:grid-cols-3"
            data-design-home-experiment-history-cards
            inert
          >
            {DESIGN_HOME_HISTORY_CARDS.map((card) => (
              <HomeExperimentCard key={card.id} card={card} variant="history" />
            ))}
          </div>
        </Section>

        <Separator />

        <Section title="Pulse billing return confirmation">
          <div inert>
            <PulseTrialBillingContinuationView
              action="start_pulse_now"
              errorMessage={null}
              onConfirm={() => {}}
              onDismiss={() => {}}
              status="confirming"
            />
          </div>
        </Section>

        <Separator />

        <Section title="Homepage auth transitions">
          <div
            className="flex flex-col gap-6"
            data-design-homepage-auth-transitions
            id="homepage-auth-transitions"
          >
            <p className="text-sm text-muted-foreground">
              Secure sign in keeps the ordinary methods visible while the
              provider initializes. A selected method owns the pending state
              immediately. If hydration discovers an existing session before
              submission, method actions pause until its linked account is
              known, then recovery takes priority. Otherwise account completion
              stays on that production action through the next view.
            </p>
            <div
              className="grid items-start gap-5 lg:grid-cols-2"
              data-design-homepage-auth-readiness
              inert
            >
              <DialogPreviewFrame label="Queued action delay">
                <HostedPrivyReadinessState
                  onRestart={() => {}}
                  restartAvailable={false}
                />
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Repeated provider delay">
                <HostedPrivyReadinessState
                  onRestart={() => {}}
                  restartAvailable
                />
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Enabled alternate methods">
                <div className="grid grid-cols-2 gap-3">
                  <HostedTelegramAuthButtonPresentation onClick={() => {}} />
                  <HostedInlineAuthButton
                    icon={<EmailIcon className="size-5" />}
                    onClick={() => {}}
                  >
                    Email
                  </HostedInlineAuthButton>
                </div>
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Telegram ready handoff">
                <HostedTelegramAuthButtonPresentation
                  active
                  onClick={() => {}}
                  readyToContinue
                />
              </DialogPreviewFrame>
            </div>
            <div
              className="grid items-start gap-5 lg:grid-cols-2"
              id="homepage-auth-hydrated-session-recovery"
              inert
            >
              <DialogPreviewFrame label="Session identity hydration">
                <HostedPrivyReadinessState
                  message="Secure sign in is checking your existing session."
                  onRestart={() => {}}
                  restartAvailable={false}
                />
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Hydrated email session recovery">
                <div className="space-y-4">
                  <HostedResumableAuthState
                    auth={{ identityLabel: "member@example.com", method: "email" }}
                    disabled={false}
                    onContinue={() => {}}
                    onSignOut={() => {}}
                    pending={false}
                  />
                  <HostedAuthPanelAlternateMethods>
                    <HostedTelegramAuthButtonPresentation onClick={() => {}} />
                    <HostedInlineAuthButton
                      icon={<EmailIcon className="size-5" />}
                      onClick={() => {}}
                    >
                      Email
                    </HostedInlineAuthButton>
                  </HostedAuthPanelAlternateMethods>
                </div>
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Hydrated phone session recovery">
                <div className="space-y-4">
                  <HostedAuthenticatedPhoneAuthState
                    body=""
                    description=""
                    disabled={false}
                    onContinue={() => {}}
                    onUseDifferentNumber={() => {}}
                    pendingAction={null}
                    secondaryActionSize="lg"
                    title=""
                    view="manual-resume"
                  />
                  <HostedAuthPanelAlternateMethods>
                    <HostedTelegramAuthButtonPresentation onClick={() => {}} />
                    <HostedInlineAuthButton
                      icon={<EmailIcon className="size-5" />}
                      onClick={() => {}}
                    >
                      Email
                    </HostedInlineAuthButton>
                  </HostedAuthPanelAlternateMethods>
                </div>
              </DialogPreviewFrame>
            </div>
            <div className="grid items-start gap-5 lg:grid-cols-2" inert>
              <DialogPreviewFrame label="Telegram completion">
                <div className="grid grid-cols-2 gap-3">
                  <HostedTelegramAuthButtonPresentation
                    active
                    completionPending
                    disabled
                    onClick={() => {}}
                  />
                  <HostedInlineAuthButton
                    disabled
                    icon={<CheckCircle2 aria-hidden="true" className="size-5" />}
                    onClick={() => {}}
                  >
                    Email
                  </HostedInlineAuthButton>
                </div>
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Phone verification completion">
                <HostedCodeEntryStep
                  autoFocus={false}
                  code="123456"
                  disableSignup={false}
                  disabled
                  onCodeChange={() => {}}
                  onResendCode={() => {}}
                  onUseDifferentNumber={() => {}}
                  onVerifyCode={() => {}}
                  pendingAction="verify-code"
                  secondaryActionSize="lg"
                  size="compact"
                  verificationPhoneNumberHint="*** 2671"
                />
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Phone resume completion">
                <HostedAuthenticatedPhoneAuthState
                  body=""
                  description=""
                  disabled
                  onContinue={() => {}}
                  onUseDifferentNumber={() => {}}
                  pendingAction="continue"
                  secondaryActionSize="lg"
                  title=""
                  view="manual-resume"
                />
              </DialogPreviewFrame>
              <DialogPreviewFrame label="Resumable completion">
                <HostedResumableAuthState
                  auth={{ identityLabel: null, method: "telegram" }}
                  disabled
                  onContinue={() => {}}
                  onSignOut={() => {}}
                  pending
                />
              </DialogPreviewFrame>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Consent appears directly from completion status
            </p>
            <div className="grid items-start gap-5 lg:grid-cols-2" inert>
              <div
                className="max-w-md rounded-2xl bg-[#FAF8F4] p-6 ring-1 ring-[#1A1F16]/[0.06] sm:p-7"
                data-design-homepage-consent="combined"
              >
                <HostedLegalConsentCard
                  initialStatus={DESIGN_DASHBOARD_CONSENT_STATUS}
                  mode="compact"
                  onDecline={() => {}}
                  source="design-homepage-consent-combined"
                />
              </div>
              <div
                className="max-w-md rounded-2xl bg-[#FAF8F4] p-6 ring-1 ring-[#1A1F16]/[0.06] sm:p-7"
                data-design-homepage-consent="health-data"
              >
                <HostedLegalConsentCard
                  initialStatus={DESIGN_HEALTH_DATA_ONLY_CONSENT_STATUS}
                  mode="compact"
                  onDecline={() => {}}
                  source="design-homepage-consent-health-data"
                />
              </div>
              <div
                className="max-w-md rounded-2xl bg-[#FAF8F4] p-6 ring-1 ring-[#1A1F16]/[0.06] sm:p-7"
                data-design-homepage-consent="legal"
              >
                <HostedLegalConsentCard
                  initialStatus={DESIGN_LEGAL_ONLY_CONSENT_STATUS}
                  mode="compact"
                  onDecline={() => {}}
                  source="design-homepage-consent-legal"
                />
              </div>
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Dashboard legal update">
          <div
            className="rounded-2xl border border-border bg-background px-5 py-6 sm:px-8"
            data-design-dashboard-legal-composition="true"
          >
            <HostedLegalConsentCard
              acceptedPendingLabel="Refreshing..."
              acceptScope={acceptDesignDashboardConsentScope}
              initialStatus={DESIGN_DASHBOARD_CONSENT_STATUS}
              launchDescription="We updated Murph's legal documents. Accept the current versions to get your full dashboard back."
              launchTitle="Review what changed"
              mode="compact"
              onAccepted={completeDesignDashboardConsentPreview}
              source="dashboard-legal-update"
            />
            <div className="mt-8 border-t border-border py-8">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
                Requested dashboard content remains available
              </p>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div>
                  <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                    Connect devices
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Stale legal consent does not block configured device connections.
                  </p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {DESIGN_AVAILABLE_CONNECT_SOURCES.map((source) => (
                  <SourceCard
                    authenticated
                    errorMessage={null}
                    key={source.id}
                    onDisconnectTargetChange={() => {}}
                    onStartConnection={() => Promise.resolve()}
                    pending={false}
                    pendingDisconnect={false}
                    source={source}
                  />
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Separator />

        <div
          data-design-component="environment-empty-state"
          id="environment-empty-state-component"
        >
          <Section title="Environment empty state">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Production zero-data state. One voice-first action leads to the
              walkthrough, while the real report categories preview what Murph
              will build without showing empty scores or missing facts.
            </p>
            <EnvironmentEmptyState
              contactOptions={[
                {
                  href: "sms:+15555550100?body=I%20want%20to%20update%20what%20you%20know%20about%20my%20home%20environment.",
                  kind: "text",
                  label: "Messages",
                },
                {
                  href: "https://t.me/withmurph_bot",
                  kind: "telegram",
                  label: "Telegram",
                },
              ]}
            />
          </Section>
        </div>

        <Separator />

        <div
          data-design-component="environment-capture-card"
          id="environment-capture-card-component"
          inert
        >
          <Section title="Environment progressive capture">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Production partial-data state. The action opens a voice script
              built only from facts Murph still does not know.
            </p>
            <EnvironmentCaptureCard
              contactOptions={[]}
              coverage={70}
              known={21}
              script={DESIGN_ENVIRONMENT_GAP_SCRIPT}
            />
          </Section>
        </div>

        <Separator />

        <div
          data-design-component="environment-voice-refresh-notice"
          id="environment-voice-refresh-notice-component"
          inert
        >
          <Section title="Environment voice processing feedback">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              The open report keeps ownership after upload: processing,
              updated, no-clear-facts, and delayed recovery remain visible
              without requiring a reload. Processing stays animated, and the
              delayed action rechecks the existing accepted job.
            </p>
            <div className="grid gap-4">
              <EnvironmentVoiceRefreshNotice
                state={{
                  baselineValues: "{}",
                  status: "processing",
                }}
                onCheckAgain={() => {}}
              />
              <EnvironmentVoiceRefreshNotice
                state={{ factsChanged: true, status: "updated" }}
                onCheckAgain={() => {}}
              />
              <EnvironmentVoiceRefreshNotice
                state={{ factsChanged: false, status: "updated" }}
                onCheckAgain={() => {}}
              />
              <EnvironmentVoiceRefreshNotice
                state={{ status: "delayed" }}
                onCheckAgain={() => {}}
              />
            </div>
          </Section>
        </div>

        <Separator />

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg">Start Experiment →</Button>
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <AuthButton variant="outline">Auth Button</AuthButton>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="xs">Extra Small</Button>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
          </div>
        </Section>

        <Separator />

        <Section title="Payment Button">
          <p className="text-sm text-muted-foreground">Async action button with spinner → checkmark animation. Auth-gated by default. Click to see the flow.</p>
          <div className="flex flex-wrap items-center gap-4">
            <PaymentButton
              onClick={() => new Promise((r) => setTimeout(r, 2000))}
              idleLabel="Subscribe · $8/mo"
              idleAdornment={<span className="text-sm">→</span>}
              onSuccess={() => {}}
            />
            <PaymentButton
              onClick={() => new Promise((r) => setTimeout(r, 1500))}
              idleLabel="Upgrade plan"
              variant="secondary"
              onSuccess={() => {}}
            />
            <PaymentButton
              onClick={() => new Promise((r) => setTimeout(r, 1500))}
              idleLabel="Confirm purchase"
              variant="outline"
              size="default"
              onSuccess={() => {}}
            />
          </div>
        </Section>


        <Separator />

        <Section title="Input & Label">
          <div className="grid max-w-sm gap-6">
            <div className="grid gap-2">
              <Label htmlFor="email-ds">Email</Label>
              <Input id="email-ds" type="email" placeholder="you@example.com" />
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="notes-ds">Notes</FieldLabel>
                <Textarea
                  id="notes-ds"
                  placeholder="Add a plain-text note"
                />
                <FieldDescription>
                  A multiline field with supporting help text.
                </FieldDescription>
              </Field>
              <Field data-invalid="true">
                <FieldLabel htmlFor="invalid-notes-ds">Invalid notes</FieldLabel>
                <Textarea
                  aria-invalid="true"
                  defaultValue="This example needs attention."
                  id="invalid-notes-ds"
                />
                <FieldError>Review this value before continuing.</FieldError>
              </Field>
              <Field data-disabled="true">
                <FieldLabel htmlFor="disabled-notes-ds">Disabled notes</FieldLabel>
                <Textarea
                  defaultValue="Locked value"
                  disabled
                  id="disabled-notes-ds"
                />
              </Field>
            </FieldGroup>
            <div className="grid gap-2">
              <Label htmlFor="disabled-ds">Disabled</Label>
              <Input id="disabled-ds" placeholder="Can't edit this" disabled />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone-number-ds">Phone number</Label>
              <PhoneNumberInput
                id="phone-number-ds"
                options={HOSTED_PHONE_COUNTRY_OPTIONS}
                selectedCountry={selectedPhoneInputCountry}
                value={phoneInputValue}
                onCountryChange={setPhoneInputCountryCode}
                onPhoneNumberChange={setPhoneInputValue}
              />
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Input OTP">
          <div className="grid gap-2">
            <Label htmlFor="otp-ds">Verification code</Label>
            <InputOTP id="otp-ds" maxLength={6} autoComplete="one-time-code">
              <InputOTPGroup>
                <InputOTPSlot index={0} className="size-11 bg-card text-base" />
                <InputOTPSlot index={1} className="size-11 bg-card text-base" />
                <InputOTPSlot index={2} className="size-11 bg-card text-base" />
                <InputOTPSlot index={3} className="size-11 bg-card text-base" />
                <InputOTPSlot index={4} className="size-11 bg-card text-base" />
                <InputOTPSlot index={5} className="size-11 bg-card text-base" />
              </InputOTPGroup>
            </InputOTP>
          </div>
        </Section>

        <Separator />

        <Section title="Select">
          <div className="max-w-xs">
            <Select>
              <SelectTrigger><SelectValue placeholder="Choose experiment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sauna">Finnish Sauna Protocol</SelectItem>
                <SelectItem value="cold">Cold Exposure</SelectItem>
                <SelectItem value="sleep">Sleep Optimization</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Section>

        <Separator />

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Warning</Badge>
            <Badge variant="study">OBS</Badge>
            <Badge variant="study">RCT</Badge>
            <Badge variant="study">MA</Badge>
          </div>
        </Section>

        <Separator />

        <Section title="Avatar">
          <div className="flex items-center gap-3">
            <Avatar><AvatarFallback>RP</AvatarFallback></Avatar>
            <Avatar><AvatarFallback>AH</AvatarFallback></Avatar>
            <Avatar><AvatarFallback>PA</AvatarFallback></Avatar>
          </div>
        </Section>

        <Separator />

        <Section title="Toggle & Toggle Group">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2"><Toggle>Bold</Toggle><Toggle>Italic</Toggle></div>
            <ToggleGroup defaultValue={["7d"]}>
              <ToggleGroupItem value="7d">7d</ToggleGroupItem>
              <ToggleGroupItem value="21d">21d</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </Section>

        <Separator />

        <Section
          id="assistant-provider-picker"
          title="Radio group, choice cards & inference routing"
        >
          <p className="max-w-2xl text-sm text-muted-foreground">
            Compare model choice cards, provider privacy labels, and the
            included-capacity disclosure and its accessible Save association
            shown after Venice is selected.
          </p>
          <RadioGroup
            className="grid gap-3 sm:grid-cols-3"
            value={choiceCardValue}
            onValueChange={setChoiceCardValue}
          >
            <ChoiceCard
              artwork={<AssistantModelArtwork variant="luna" />}
              className={ASSISTANT_MODEL_CHOICE_CARD_CLASSES.luna}
              description="Fast health intelligence"
              id="design-choice-luna"
              meta="Low usage"
              title="Luna"
              value="luna"
            />
            <ChoiceCard
              artwork={<AssistantModelArtwork variant="terra" />}
              badge={<Badge variant="outline">Recommended</Badge>}
              className={ASSISTANT_MODEL_CHOICE_CARD_CLASSES.terra}
              description="Advanced health intelligence"
              id="design-choice-terra"
              meta="Balanced usage"
              title="Terra"
              value="terra"
            />
            <ChoiceCard
              artwork={<AssistantModelArtwork variant="sol" />}
              badge={<Badge variant="outline">Edge</Badge>}
              className={ASSISTANT_MODEL_CHOICE_CARD_CLASSES.sol}
              description="Highest health intelligence"
              id="design-choice-sol"
              meta="High usage · Edge plan"
              title="Sol"
              value="sol"
            />
          </RadioGroup>
          <AssistantProviderSummary
            connection={DESIGN_INFERENCE_CONNECTION}
            currentRouting={HOSTED_ASSISTANT_OPENAI_PROVIDER}
            draftRouting={providerValue}
            onChangeClick={() => setProviderDialogOpen(true)}
          />
          <AssistantProviderDialog
            chatCompletionsAvailable
            connection={DESIGN_INFERENCE_CONNECTION}
            customInferenceAvailable
            onOpenChange={setProviderDialogOpen}
            onRoutingChange={setProviderValue}
            open={providerDialogOpen}
            routing={providerValue}
            veniceAvailable
          />
        </Section>

        <Separator />

        <Section title="Custom inference endpoint pane">
          <div inert>
            <HostedInferenceConnectionPane
              chatCompletionsAvailable
              configurationAvailable={false}
              connection={null}
              onConnectionChange={() => {}}
              selected={false}
            />
          </div>
        </Section>

        <Separator />

        <Section title="Spinner">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner aria-hidden="true" />
              Loading
            </div>
            <Button disabled>
              <Spinner aria-hidden="true" />
              Saving
            </Button>
          </div>
        </Section>

        <Separator />

        <Section title="Segmented Control">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Default tokens
              </p>
              <SegmentedControl
                aria-label="Contact method"
                options={SEGMENTED_CONTROL_OPTIONS}
                value={segmentedControlValue}
                onValueChange={setSegmentedControlValue}
              />
            </div>
            <div className="flex flex-col gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Family invite palette
              </p>
              <SegmentedControl
                aria-label="Invite by"
                options={SEGMENTED_CONTROL_OPTIONS}
                value={warmSegmentedControlValue}
                onValueChange={setWarmSegmentedControlValue}
                className="border-[#c4a882]/25 bg-[#f5f0e8]"
                itemClassName="text-[#736a58] hover:bg-[#fffcf6]/70 hover:text-[#2d3436] aria-pressed:bg-[#fffcf6] aria-pressed:text-[#2d3436] aria-pressed:shadow-none"
              />
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Setup Loader">
          <p className="text-sm text-muted-foreground">
            Full-page loader shown on <code className="font-mono text-xs">/join/[inviteCode]</code> while
            the auto-trial is provisioned. The Murph mark fires a sonar ripple from its two
            largest core dots outward — each dot&apos;s delay is proportional to its distance
            from center, so the wave radiates through the constellation rather than pulsing
            uniformly. Honors <code className="font-mono text-xs">prefers-reduced-motion</code>.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col items-center justify-center gap-6 rounded-2xl bg-[#FAF8F4] px-8 py-16 ring-1 ring-[#1A1F16]/[0.06]">
              <MurphPulseLoader className="h-24 w-auto" />
              <p className="font-serif text-2xl font-normal text-foreground">
                Setting up your Murph
              </p>
            </div>
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-[#FAF8F4] px-8 py-16 ring-1 ring-[#1A1F16]/[0.06]">
              <MurphPulseLoader className="h-14 w-auto" durationMs={1400} />
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Compact · 1.4s cycle
              </p>
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Alert">
          <div className="flex flex-col gap-4">
            <Alert><AlertTitle>Experiment in progress</AlertTitle><AlertDescription>Day 15 of 28. Next session scheduled for this evening.</AlertDescription></Alert>
            <Alert variant="destructive"><AlertTitle>Oura disconnected</AlertTitle><AlertDescription>Reconnect your ring to continue tracking metrics.</AlertDescription></Alert>
          </div>
        </Section>

        <Separator />

        <Section title="Connect Callback Error Notice">
          <div className="flex flex-col gap-4" inert>
            <ConnectCallbackErrorNotice
              errorCode="CALLBACK_PROOF_INVALID"
              message="That return link did not match the browser you started in, so nothing was connected. Start Oura again from this page."
              sourceLabel="Oura"
              title="Unable to finish connection"
            />
            <ConnectCallbackErrorNotice
              errorCode="CALLBACK_SESSION_REQUIRED"
              message="You were signed out before Oura finished connecting. Log in, then start the connection again."
              onSignIn={() => {}}
              sourceLabel="Oura"
              title="Unable to finish connection"
            />
          </div>
        </Section>

        <Separator />

        <Section title="Account Deletion Status">
          <div className="grid gap-4 lg:grid-cols-2">
            <HostedAccountDeletionStatus cleanupPending={false} />
            <HostedAccountDeletionStatus cleanupPending />
          </div>
        </Section>

        <Separator />

        <Section title="Support Action">
          <div className="flex flex-col gap-3">
            <Alert variant="destructive">
              <AlertTitle>Unable to update Telegram</AlertTitle>
              <AlertDescription>This verified session conflicts with an existing Murph account.</AlertDescription>
            </Alert>
            <ContactSupportAction
              body="Hi Murph support,\n\nI need help with an account conflict."
              subject="Murph account support"
            />
          </div>
        </Section>

        <Separator />

        <Section title="Skeleton">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Skeleton className="size-12 rounded-full" />
              <div className="flex flex-col gap-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-32" /></div>
            </div>
            <div className="flex gap-3"><Skeleton className="h-24 flex-1 rounded-xl" /><Skeleton className="h-24 flex-1 rounded-xl" /><Skeleton className="h-24 flex-1 rounded-xl" /></div>
          </div>
        </Section>

        <Separator />

        <Section title="Tooltip">
          <Tooltip>
            <div className="flex"><TooltipTrigger render={<Button variant="outline">Hover me</Button>} /></div>
            <TooltipContent><p>92% match based on your Oura data</p></TooltipContent>
          </Tooltip>
        </Section>

        <Separator />

        <Section title="Dialog">
          <Dialog>
            <div className="flex"><DialogTrigger render={<Button>Open Dialog</Button>} /></div>
            <DialogContent>
              <DialogHeader><DialogTitle>Start Experiment</DialogTitle><DialogDescription>This will begin a 14-day baseline period followed by 14 days of active tracking.</DialogDescription></DialogHeader>
              <div className="flex justify-end gap-2 pt-4"><Button variant="outline">Cancel</Button><Button>Confirm</Button></div>
            </DialogContent>
          </Dialog>
        </Section>

        <Separator />

        <Section title="Private experiment results share">
          <ExperimentResultsShareStudy />
        </Section>

        <Separator />

        <Section title="Hosted plan change">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Immediate upgrades open Stripe&apos;s exact proration confirmation.
            Period-end switches keep their in-product scheduling confirmation.
          </p>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Period-end switch
              </p>
              <Dialog>
                <div
                  className="space-y-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7"
                  inert
                >
                  <HostedPlanChangeConfirmationContent
                    currentPeriodEnd="2026-08-27T04:00:00.000Z"
                    errorMessage={null}
                    onClose={() => undefined}
                    onConfirm={() => undefined}
                    pending={false}
                    targetPlanCode="launch_group_monthly"
                  />
                </div>
              </Dialog>
            </div>
            <div className="space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Immediate upgrade entry
              </p>
              <div
                className="rounded-2xl bg-muted/45 p-6"
                inert
              >
                <UpgradeToEdgeButton expectedCurrentPlanCode="launch_monthly" />
              </div>
            </div>
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Return · syncing
              </p>
              <div inert>
                <HostedPlanUpdateReturn
                  active={false}
                  pollingEnabled={false}
                  targetPlanCode="launch_edge_monthly"
                />
              </div>
            </div>
            <div className="space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Return · active
              </p>
              <div inert>
                <HostedPlanUpdateReturn
                  active
                  pollingEnabled={false}
                  targetPlanCode="launch_edge_monthly"
                />
              </div>
            </div>
          </div>
        </Section>

        <Separator />

        <div id="whoop-completion-dialog" className="scroll-mt-24">
          <Section title="WHOOP Completion Dialog">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Production WHOOP completion and capacity fallback. The normal flow
              starts with confirmation; the capacity path opens the same setup guide directly.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setWhoopCompletionPreviewKey((key) => key + 1)}>
                Preview WHOOP completion
              </Button>
              <Button variant="outline" onClick={() => setWhoopCapacityPreviewOpen(true)}>
                Preview capacity fallback
              </Button>
              <Button
                variant="outline"
                onClick={() => setWhoopCapacityNoContactPreviewOpen(true)}
              >
                Preview capacity fallback without contact route
              </Button>
            </div>
            {whoopCompletionPreviewKey > 0 ? (
              <DeviceSyncCompletionDialog
                key={whoopCompletionPreviewKey}
                model={WHOOP_COMPLETION_DIALOG_MODEL}
              />
            ) : null}
            <DeviceSyncSetupGuideDialog
              contactAction={WHOOP_COMPLETION_DIALOG_MODEL.contactAction}
              guide={WHOOP_COMPLETION_SETUP_GUIDE}
              open={whoopCapacityPreviewOpen}
              onOpenChange={setWhoopCapacityPreviewOpen}
            />
            <DeviceSyncSetupGuideDialog
              contactAction={null}
              guide={WHOOP_COMPLETION_SETUP_GUIDE}
              open={whoopCapacityNoContactPreviewOpen}
              onOpenChange={setWhoopCapacityNoContactPreviewOpen}
            />
          </Section>
        </div>

        <Separator />

        <Section title="Usage credit">
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Personal, Family, and group funding use a saved card when available
            and send card entry or verification to Stripe only when needed.
            Family owners reuse the standard amount dialog with an exact member
            label and status-only recovery when another target owns the active
            checkout. Credit is added only after Stripe confirms payment.
          </p>
          <div className="grid gap-6 xl:grid-cols-2 2xl:grid-cols-4">
            <div
              className="rounded-3xl border border-border bg-card p-6"
              data-design-component="personal-usage-top-up"
              id="personal-usage-top-up-component"
            >
              <p className="text-sm font-medium text-muted-foreground">
                Personal usage
              </p>
              <p className="mt-1 font-serif text-2xl font-semibold tracking-normal text-foreground">
                Keep the conversation going
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Add one-time usage with a saved card or continue securely in
                Stripe when needed.
              </p>
              <div className="mt-6">
                <HostedUsageTopUpDialog
                  checkoutUrl="/api/design/usage-credit-preview"
                  inert
                  offers={DESIGN_USAGE_OFFERS}
                  payerMemberId="design_usage_top_up_payer"
                  scope="personal"
                />
              </div>
            </div>
            <div
              data-design-component="group-usage-funding"
              id="group-usage-funding-component"
            >
              <GroupUsageFundingShell
                action={(
                  <GroupUsageFundingActions
                    monthlyAction={(
                      <GroupSponsorshipDialog
                        checkoutUrl={`${DESIGN_SIGNED_GROUP_FUNDING_ENDPOINT}/usage-credit/checkout`}
                        customizationAllowed
                        inert
                        mode="monthly"
                        monthlyCapMinor={1_000}
                        monthlyCapOptions={DESIGN_GROUP_MONTHLY_CAPS}
                        offers={[DESIGN_GROUP_SPONSORSHIP_OFFERS[0]]}
                        payerMemberId="design_usage_top_up_payer"
                      />
                    )}
                    oneTimeAction={(
                      <GroupSponsorshipDialog
                        checkoutUrl={`${DESIGN_SIGNED_GROUP_FUNDING_ENDPOINT}/usage-credit/checkout`}
                        customizationAllowed
                        inert
                        mode="one_time"
                        offers={DESIGN_GROUP_SPONSORSHIP_OFFERS}
                        payerMemberId="design_usage_top_up_payer"
                        triggerSize="default"
                        triggerVariant="link"
                      />
                    )}
                  />
                )}
                groupName="Sunday sleep crew"
              />
            </div>
            <div
              data-design-component="group-sponsorship-management"
              id="group-sponsorship-management-component"
              inert
            >
              <GroupSponsorshipManagementCard
                endpoint={`${DESIGN_SIGNED_GROUP_FUNDING_ENDPOINT}/sponsorship`}
                inert
                management={{
                  authorizationId: "hgsa_design_component",
                  chargedThisPeriodMinor: 500,
                  monthlyCapMinor: 1_000,
                  pendingMonthlyCapMinor: null,
                  pendingThisPeriodMinor: 500,
                  periodEnd: "2026-08-30T16:00:00.000Z",
                  status: "active",
                }}
              />
            </div>
            <div
              className="rounded-3xl border border-border bg-card p-6"
              data-design-component="family-member-usage-top-up"
              id="family-member-usage-top-up-component"
            >
              <p className="text-sm font-medium text-muted-foreground">
                Family member
              </p>
              <p className="mt-1 font-serif text-2xl font-semibold tracking-normal text-foreground">
                Alex
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Purchase one-time usage credit for this member, or resolve an
                unfinished checkout for another usage destination.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <HostedUsageTopUpDialog
                  checkoutUrl="/api/design/usage-credit-preview"
                  inert
                  offers={DESIGN_USAGE_OFFERS}
                  payerMemberId="design_usage_top_up_payer"
                  scope="family"
                  targetLabel="Alex"
                />
                <HostedUsageTopUpDialog
                  activePurchase={{
                    offerCode: "usage_10_usd",
                    purchaseId: "design_other_target",
                    retryAllowed: false,
                    status: "checkout_open",
                    targetConflict: true,
                  }}
                  checkoutUrl="/api/design/usage-credit-preview"
                  inert
                  offers={[]}
                  payerMemberId="design_usage_top_up_payer"
                  scope="family"
                  targetLabel="Alex"
                />
              </div>
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Vital-backed health source handoff">
          <div className="flex flex-col items-start gap-3">
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Reusable handoff shown before every Vital-backed authorization.
              It leads with the connection, credits Vital underneath with a
              link, and keeps Garmin&apos;s Historical Data reminder inside
              the same dialog.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                {
                  label: "Preview standard handoff",
                  source: {
                    id: "fitbit",
                    logo: {
                      className: "size-11 object-contain",
                      height: 44,
                      src: "/brand-logos/connect/fitbit.svg",
                      width: 44,
                    },
                    name: "Fitbit",
                  },
                  variant: "default" as const,
                },
                {
                  label: "Preview Garmin handoff",
                  source: {
                    id: "garmin",
                    logo: {
                      className: "size-11 object-contain",
                      height: 44,
                      src: "/brand-logos/connect/garmin.png",
                      width: 44,
                    },
                    name: "Garmin",
                  },
                  variant: "outline" as const,
                },
                {
                  label: "Preview wide logo",
                  source: {
                    id: "runkeeper",
                    logo: {
                      className: "h-auto max-h-7 w-auto max-w-[8rem] object-contain",
                      height: 20,
                      src: "/brand-logos/connect/runkeeper.svg",
                      width: 132,
                    },
                    name: "Runkeeper",
                  },
                  variant: "outline" as const,
                },
                {
                  label: "Preview long label",
                  source: {
                    id: "dexcom-g6-and-older",
                    logo: {
                      className: "size-11 object-contain",
                      height: 44,
                      src: "/brand-logos/connect/dexcom-g6-and-older.png",
                      width: 44,
                    },
                    name: "Dexcom (G6 and older)",
                  },
                  variant: "outline" as const,
                },
              ].map((preview) => (
                <Button
                  key={preview.source.id}
                  variant={preview.variant}
                  onClick={() => setVitalConnectionDialogSource(preview.source)}
                >
                  {preview.label}
                </Button>
              ))}
            </div>
          </div>
          <VitalConnectionDialog
            source={vitalConnectionDialogSource}
            onContinue={() => setVitalConnectionDialogSource(null)}
            onOpenChange={(open) => {
              if (!open) {
                setVitalConnectionDialogSource(null);
              }
            }}
          />
        </Section>

        <Separator />

        <Section
          id="experiment-start-channel-picker-study"
          title="Experiment Start Channel Picker"
        >
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-serif text-xl font-semibold tracking-normal text-foreground">
                Continue in the app you already use
              </p>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                The compact picker keeps the selected experiment visible and
                prepares a short message for review.
              </p>
            </div>
            <Button onClick={() => setChannelPickerOpen(true)}>
              Preview picker
            </Button>
          </div>
          <StartExperimentChannelDialog
            onOpenChange={setChannelPickerOpen}
            open={channelPickerOpen}
            options={EXPERIMENT_START_CHANNEL_OPTIONS}
            protocolDays={14}
            protocolTitle="Example Evening Routine"
          />
        </Section>

        <Separator />

        <Section title="Email Murph Picker">
          <p className="text-sm text-muted-foreground">
            Settings link that opens a chooser between the native mail app and the
            user&apos;s webmail provider. Provider is detected from the member&apos;s
            email domain; addresses on unknown providers fall through to a plain
            mailto link (no dialog).
          </p>
          <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Brand icons
            </span>
            <div className="flex items-center gap-3">
              <WebmailIcon label="Gmail" className="size-6" />
              <WebmailIcon label="Outlook" className="size-6" />
              <WebmailIcon label="Yahoo Mail" className="size-6" />
              <WebmailIcon label="Proton Mail" className="size-6" />
              <WebmailIcon label="Fastmail" className="size-6" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Gmail", userEmail: "member@gmail.com", icon: "Gmail" as const },
              { label: "Outlook", userEmail: "member@outlook.com", icon: "Outlook" as const },
              { label: "Yahoo Mail", userEmail: "member@yahoo.com", icon: "Yahoo Mail" as const },
              { label: "Proton Mail", userEmail: "member@proton.me", icon: "Proton Mail" as const },
              { label: "Fastmail", userEmail: "member@fastmail.com", icon: "Fastmail" as const },
              { label: "Custom domain (no dialog)", userEmail: "member@example.com", icon: null },
            ].map((variant) => (
              <div
                key={variant.label}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  {variant.icon ? (
                    <WebmailIcon label={variant.icon} className="size-4 shrink-0" />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {variant.label}
                  </span>
                </div>
                <HostedEmailMurphContactDialog
                  murphEmailAddress="murph@mail.withmurph.ai"
                  userEmailAddress={variant.userEmail}
                />
              </div>
            ))}
          </div>
        </Section>

        <Separator />

        <Section id="phone-account-linking" title="Phone Account Linking">
          <p className="text-sm leading-6 text-muted-foreground">
            Settings opens the authenticated identity provider directly, with
            no second Murph confirmation. After verification or an approved
            account transfer, Murph saves the exact provider-owned result. If
            Privy already has a verified phone that Murph has not recorded,
            Settings repairs that projection directly. A declined transfer
            closes quietly, and a failed save retries without reopening Privy.
            Existing phone accounts use the same surface for replacement.
            Support-required conflicts stop retrying and leave one direct email
            action without putting account identifiers in the message.
            Privacy-safe lifecycle diagnostics observe these states without
            changing any rendered state or action.
          </p>
          <div className="grid gap-4 sm:grid-cols-2" inert>
            <div className="space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Add phone
              </p>
              <HostedPhoneLinkAction
                isChangeFlow={false}
                isLinking={false}
                isSyncing={false}
                onClick={() => {}}
              />
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Replace phone
              </p>
              <HostedPhoneLinkAction
                isChangeFlow
                isLinking={false}
                isSyncing={false}
                onClick={() => {}}
              />
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Provider opening
              </p>
              <HostedPhoneLinkAction
                disabled
                isChangeFlow={false}
                isLinking
                isSyncing={false}
                onClick={() => {}}
              />
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Session mismatch
              </p>
              <HostedIdentitySessionMismatch onSignInAgain={() => {}} />
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Provider loading
              </p>
              <HostedIdentitySessionLoading />
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-card p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Recovery failed
              </p>
              <HostedIdentitySessionMismatch
                errorMessage="Sign out did not finish. Try again."
                onSignInAgain={() => {}}
              />
            </div>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            The join card composes that action with its reserved status line
            and the Telegram alternative. The status line holds its height
            while empty so the button never moves when a message arrives, so
            these previews show the real resting spacing between the two
            contact channels.
          </p>
          <div
            aria-label="Composed contact channel card previews"
            className="grid max-w-3xl gap-4 sm:grid-cols-2"
            data-design-component="hosted-contact-channel-choice"
            inert
          >
            {[
              {
                disabled: false,
                errorMessage: null,
                label: "Resting",
                showPhoneAction: true,
                state: "resting",
                statusMessage: null,
                statusTone: "neutral" as const,
              },
              {
                disabled: false,
                errorMessage: null,
                label: "Saved status",
                showPhoneAction: true,
                state: "status",
                statusMessage: "Phone saved.",
                statusTone: "success" as const,
              },
              {
                disabled: true,
                errorMessage:
                  "That phone moved from another Murph account that is still active with its own sign-in. Contact support to reconcile it safely.",
                label: "Support required",
                showPhoneAction: false,
                state: "support-required",
                statusMessage:
                  "That phone moved from another Murph account that is still active with its own sign-in. Contact support to reconcile it safely.",
                statusTone: "destructive" as const,
              },
            ].map((preview) => (
              <div
                className="space-y-3 rounded-xl border border-border bg-card p-5"
                data-design-state={preview.state}
                key={preview.label}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {preview.label}
                </p>
                <HostedContactChannelChoice
                  phone={
                    <HostedPhoneLinkCardPresentation
                      disabled={preview.disabled}
                      errorMessage={preview.errorMessage}
                      isChangeFlow={false}
                      isLinking={false}
                      isSyncing={false}
                      showPhoneAction={preview.showPhoneAction}
                      statusMessage={preview.statusMessage}
                      statusTone={preview.statusTone}
                      onClick={() => {}}
                    />
                  }
                  telegram={
                    <HostedTelegramAuthButtonPresentation onClick={() => {}} />
                  }
                />
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Settings support-required dialog
            </p>
            <Button
              variant="outline"
              onClick={() => setPhoneTransferSupportDialogOpen(true)}
            >
              Preview terminal dialog
            </Button>
            {phoneTransferSupportDialogOpen
              ? (
                  <HostedPhonePrivyHandOffStatus
                    errorMessage="That phone moved from another Murph account that is still active with its own sign-in. Contact support to reconcile it safely."
                    isLinking={false}
                    isRetryAllowed={false}
                    isSyncing={false}
                    onAborted={() => setPhoneTransferSupportDialogOpen(false)}
                    onRetry={() => {}}
                  />
                )
              : null}
          </div>
        </Section>

        <Separator />

        <Section title="Hosted AI usage credits and referrals">
          <p className="text-sm text-muted-foreground">
            Read-only Settings detail keeps current referrals visible and
            moves completed referrals and purchased credits into quiet history.
          </p>
          <div
            aria-label="Read-only hosted AI usage activity previews"
            className="flex max-w-3xl flex-col gap-8"
            data-design-component="hosted-ai-usage-activity-states"
            inert
          >
            {[
              {
                activity: DESIGN_AI_USAGE_ACTIVITY,
                contactOption: DESIGN_USAGE_MISSION_CONTACT_OPTION,
                label: "Active referrals with completed history",
                state: "active-and-completed",
              },
              {
                activity: DESIGN_AI_USAGE_WAITING_ACTIVITY,
                contactOption: DESIGN_USAGE_MISSION_CONTACT_OPTION,
                label: "Referral selected, waiting for a new group",
                state: "waiting-for-group",
              },
              {
                activity: DESIGN_AI_USAGE_EMPTY_ACTIVITY,
                contactOption: DESIGN_USAGE_MISSION_CONTACT_OPTION,
                label: "Referrals available, none selected",
                state: "empty",
              },
              {
                activity: DESIGN_AI_USAGE_DISABLED_HISTORY,
                contactOption: null,
                label: "New referrals disabled, existing history retained",
                state: "disabled-history",
              },
            ].map((preview) => (
              <div
                className="flex flex-col gap-3"
                data-design-state={preview.state}
                id={
                  preview.state === "empty"
                    ? "hosted-ai-usage-empty"
                    : undefined
                }
                key={preview.label}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {preview.label}
                </p>
                <HostedAiUsageActivity
                  activity={preview.activity}
                  missionContactOption={preview.contactOption}
                  signupReferralUrl="https://example.com/r/design-referral"
                />
              </div>
            ))}
          </div>
        </Section>

        <Separator />

        <Section title="Signup referral link actions">
          <p className="text-sm text-muted-foreground">
            The real copy action keeps loading, clipboard, and recovery states
            distinct without moving keyboard focus away from the control.
          </p>
          <SignupReferralComponentStudy />
        </Section>

        <Separator />

        <Section title="Hosted Family Manager">
          <p className="text-sm text-muted-foreground">
            Family members and pending invites use cards under 768px and the
            compact table layout above it. This fixture keeps all contact details
            synthetic and does not submit settings mutations.
          </p>
          <div
            aria-label="Read-only hosted Family preview"
            className="rounded-xl border border-border bg-card p-5"
            inert
          >
            <HostedFamilyManager
              billingActive
              payerMemberId="design_usage_top_up_payer"
              invites={[
                {
                  acceptUrl: "/family/accept/design-preview",
                  channel: "family",
                  expiresAtIso: "2026-08-05T00:00:00.000Z",
                  id: "design-invite",
                  planCode: "edge",
                  targetEmail: `${"a".repeat(60)}@example.test`,
                  targetLabel:
                    "A deliberately long synthetic family member label for responsive containment proof",
                  targetPhoneHint: null,
                  targetTelegramUsername: null,
                  telegramInviteUrl: null,
                },
              ]}
              members={[
                {
                  isOwner: true,
                  joinedAtIso: "2026-07-01T00:00:00.000Z",
                  label: null,
                  memberId: "design-owner",
                  pendingPlanCode: null,
                  planCode: "pulse",
                },
                {
                  isOwner: false,
                  joinedAtIso: "2026-07-07T00:00:00.000Z",
                  label: "Partner",
                  memberId: "design-member",
                  pendingPlanCode: null,
                  planCode: "edge",
                },
              ]}
              plans={{
                edge: { active: 1, billed: 2, invited: 1, remaining: 0, used: 2 },
                pulse: { active: 1, billed: 1, invited: 0, remaining: 0, used: 1 },
              }}
              seats={{
                active: 2,
                billed: 3,
                invited: 1,
                max: 6,
                min: 2,
                remaining: 0,
                used: 3,
              }}
              tiers={[
                { name: "Pulse", planCode: "pulse", priceLabel: "$7/mo" },
                { name: "Edge", planCode: "edge", priceLabel: "$19/mo" },
              ]}
            />
          </div>
        </Section>

        <Separator />

        <Section title="Assistant Style Picker">
          <p className="text-sm text-muted-foreground">
            Tone and voice pickers used in onboarding (chained) and settings
            (one step at a time). Full-height drawer under 768px, dialog above;
            the voice grid is two columns on mobile and three on desktop.
          </p>
          <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-5">
            <Button onClick={() => setAssistantStylePickerStep("tone")}>
              Preview tone step
            </Button>
            <Button variant="secondary" onClick={() => setAssistantStylePickerStep("voice")}>
              Preview voice step
            </Button>
          </div>
          {assistantStylePickerStep ? (
            <MurphAssistantStylePicker
              singleStep
              initialStep={assistantStylePickerStep}
              onOpenChange={(open) => {
                if (!open) {
                  setAssistantStylePickerStep(null);
                }
              }}
              open
              // Preview only: never persist a real preference from the showcase.
              savePreference={async (preferences) => ({
                tone: "tone" in preferences ? preferences.tone : null,
                voice: "voice" in preferences ? preferences.voice : null,
              })}
            />
          ) : null}
        </Section>

        <Separator />

        <Section title="Personality Settings">
          <p className="text-sm text-muted-foreground">
            Private Humor, Push, and Detail controls. The mobile preview uses a
            full-height drawer with a safe-area footer; desktop uses a dialog.
          </p>
          <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-5">
            <Button onClick={() => setPersonalitySettingsOpen(true)}>
              Preview personality settings
            </Button>
          </div>
          <MurphPersonalitySettingsDialog
            onOpenChange={setPersonalitySettingsOpen}
            open={personalitySettingsOpen}
            personality={{ detail: 5, humor: 7, push: 8 }}
            savePersonality={async (changedDials) => ({
              detail: changedDials.detail ?? 5,
              humor: changedDials.humor ?? 7,
              push: changedDials.push ?? 8,
            })}
          />
        </Section>

        <Separator />

        <Section title="Contact Card Picker">
          <p className="text-sm text-muted-foreground">
            Post-signup drawer/dialog where a new member picks the photo on
            Murph&apos;s contact card, then adds Murph as a contact. Drawer under
            768px, dialog above. The chosen avatar only changes the picture on
            the vCard the member saves; Murph stays the same everywhere else.
          </p>
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-serif text-xl font-semibold tracking-normal text-foreground">
                Add Murph to your contacts
              </p>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                {addedContactAvatar
                  ? `Last add used the ${addedContactAvatar.label} avatar.`
                  : "No contact added yet in this preview."}
              </p>
            </div>
            <Button onClick={() => setContactCardPickerOpen(true)}>
              Preview picker
            </Button>
          </div>
          <MurphContactCardPicker
            onAddToContacts={(option) => {
              setAddedContactAvatar(option);
              setContactCardPickerOpen(false);
            }}
            onOpenChange={setContactCardPickerOpen}
            open={contactCardPickerOpen}
          />
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Avatar set
            </span>
            <div className="flex flex-wrap items-center gap-3">
              {MURPH_CONTACT_AVATAR_OPTIONS.map((option) => (
                <MurphContactAvatarArt
                  className="size-8 text-[32px] ring-1 ring-border"
                  key={option.id}
                  option={option}
                />
              ))}
            </div>
          </div>
          <div className="max-w-sm rounded-xl border border-border bg-card p-5">
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Standalone grid
            </p>
            <MurphContactAvatarGrid
              onChange={setInlineContactAvatarId}
              value={inlineContactAvatarId}
            />
          </div>
          <div className="max-w-sm rounded-xl border border-border bg-card p-5">
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              In-app browser CTA
            </p>
            <p className="mb-4 text-sm leading-6 text-muted-foreground">
              On an iOS in-app browser (X, Instagram, Facebook, TikTok, and the
              like) the WebKit view fetches the vCard but never hands it to the
              contact importer, so the normal add silently does nothing. There
              the primary action becomes a Safari escape instead.
            </p>
            <div className="flex flex-col gap-2">
              <a
                className={buttonVariants({ className: "w-full", size: "xl" })}
                href="#in-app-browser-cta-preview"
                onClick={(event) => event.preventDefault()}
              >
                <ContactRound data-icon="inline-start" />
                {IN_APP_BROWSER_PRIMARY_ACTION}
              </a>
              <p className="px-2 text-center text-xs leading-5 text-muted-foreground">
                {IN_APP_BROWSER_DESCRIPTION}
              </p>
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Sheet">
          <Sheet>
            <div className="flex"><SheetTrigger render={<Button variant="outline">Open Sheet</Button>} /></div>
            <SheetContent><SheetHeader><SheetTitle>Experiment Settings</SheetTitle><SheetDescription>Adjust protocol parameters before starting.</SheetDescription></SheetHeader></SheetContent>
          </Sheet>
        </Section>

        <Separator />

        <Section title="Dropdown Menu">
          <DropdownMenu>
            <div className="flex"><DropdownMenuTrigger render={<Button variant="outline">Actions ▾</Button>} /></div>
            <DropdownMenuContent>
              <DropdownMenuItem>View protocol</DropdownMenuItem>
              <DropdownMenuItem>Share results</DropdownMenuItem>
              <DropdownMenuItem>Export data</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        <Separator />

        <Section title="Collapsible">
          <Collapsible open={collapsibleOpen} onOpenChange={setCollapsibleOpen}>
            <CollapsibleTrigger render={<Button variant="outline">{collapsibleOpen ? "Hide" : "Show"} completed timeline</Button>} />
            <CollapsibleContent className="mt-3">
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">Timeline content that was collapsed. 8 sessions logged, 2 checkpoints reached.</div>
            </CollapsibleContent>
          </Collapsible>
        </Section>

        <Separator />

        <Section title="Scroll Area">
          <ScrollArea className="h-48 max-w-sm rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3">
              {Array.from({ length: 12 }, (_, i) => (<div key={i} className="text-sm">Mar {18 + i} · Session {i + 1} logged</div>))}
            </div>
          </ScrollArea>
        </Section>

        <Separator />

        <Section title="Table">
          <Table>
            <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Before → After</TableHead><TableHead className="text-right">Change</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell className="font-semibold">HRV</TableCell><TableCell>46.5 → 53.8 ms</TableCell><TableCell className="text-right font-semibold text-primary">+15.7%</TableCell></TableRow>
              <TableRow><TableCell className="font-semibold">Resting HR</TableCell><TableCell>64.2 → 60.1 bpm</TableCell><TableCell className="text-right font-semibold text-primary">−6.4%</TableCell></TableRow>
              <TableRow><TableCell className="font-semibold">Deep Sleep</TableCell><TableCell>1h 28m → 1h 44m</TableCell><TableCell className="text-right font-semibold text-primary">+18.2%</TableCell></TableRow>
              <TableRow><TableCell className="font-semibold">Respiratory Rate</TableCell><TableCell>11.6 → 11.3 br/min</TableCell><TableCell className="text-right text-muted-foreground">−2.6%</TableCell></TableRow>
            </TableBody>
          </Table>
        </Section>

        <Separator />

        <Section title="Tabs">
          <Tabs defaultValue="protocol" className="w-full">
            <TabsList><TabsTrigger value="protocol">Protocol</TabsTrigger><TabsTrigger value="results">Your Results</TabsTrigger></TabsList>
            <TabsContent value="protocol"><Card><CardHeader><CardTitle>Protocol content</CardTitle><CardDescription>Description of the experiment protocol.</CardDescription></CardHeader></Card></TabsContent>
            <TabsContent value="results"><Card><CardHeader><CardTitle>Your Results content</CardTitle><CardDescription>Metrics, charts, and timeline.</CardDescription></CardHeader></Card></TabsContent>
          </Tabs>
        </Section>

        <Separator />

        <Section title="Progress">
          <div className="flex flex-col gap-2">
            <div className="flex justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">Baseline · 14d ✓</span>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">Active · Day 1 of 14</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Analysis</span>
            </div>
            <Progress value={54} className="h-1.5" />
          </div>
        </Section>

        <Separator />

        <Section title="Card">
          <div className="grid grid-cols-2 gap-4">
            <Card><CardHeader><CardTitle>Default Card</CardTitle><CardDescription>Standard card with header and content.</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Card content goes here.</p></CardContent></Card>
            <Card><CardHeader><CardTitle>Research</CardTitle><CardDescription>8 studies · 6,890 participants</CardDescription></CardHeader><CardContent><p className="text-sm text-muted-foreground">Strong evidence base with 20-year follow-up.</p></CardContent></Card>
          </div>
        </Section>

        <Separator />

        <Section title="Metric Card">
          <div className="flex gap-3">
            <MetricCard label="HRV" value="53.8" unit="ms" delta="+15.7%" direction="up" baseline="46.5" expected="+10–25%" />
            <MetricCard label="Resting HR" value="60.1" unit="bpm" delta="−6.4%" direction="down" baseline="64.2" expected="−3–8 bpm" />
            <MetricCard label="Deep Sleep" value="1h44m" delta="+18.2%" direction="up" baseline="1h28m" expected="+15–30%" />
          </div>
        </Section>

        <Separator />

        <Section title="Timeline">
          <div className="max-w-sm rounded-xl border border-border bg-card p-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Plan & Timeline</span>
            <div className="mt-4 flex flex-col gap-4">
              <TimelineEntry date="Apr 15" label="End" title="Experiment ends" description="Final analysis generated" variant="default" upcoming />
              <TimelineEntry date="Apr 14" label="Checkpoint" title="Week 2 review" variant="outline" upcoming />
              <TimelineEntry date="Apr 6" label="Upcoming" title="Session 3 of 3" upcoming />
              <TimelineEntry date="Apr 5" label="Today" title="Session logged" description="20 min at 85°C. Deep sleep was 1h50m last night." />
              <TimelineEntry date="Apr 4" title="HRV milestone" description="HRV crossed 50ms for the first time." />
              <TimelineEntry date="Apr 3" title="Skipped session" description="Feeling unwell, rest day." variant="muted" />
              <TimelineEntry date="Apr 1" label="Checkpoint" title="Baseline complete" description="Baseline captured. Active phase started." variant="outline" />
              <TimelineEntry date="Mar 18" label="Start" title="Experiment started" description="Finnish Sauna Protocol · 28 days" variant="primary" last />
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Next Step Card">
          <NextStepCard title="Sauna session · 15–20 min @ 80–100°C" when="Today evening" instructions="Stay hydrated, electrolytes after" context="Session 2 of 3 this week" nextSession="Friday" />
        </Section>

        <Separator />

        <Section title="Expected Signal Card">
          <div className="flex gap-4">
            <ExpectedSignalCard label="HRV" expected="+10–25%" direction="up" description="Heat stress trains the autonomic nervous system, increasing parasympathetic dominance at rest." />
            <ExpectedSignalCard label="Resting HR" expected="-3–8 bpm" direction="down" description="Repeated heat exposure improves cardiac output efficiency, lowering resting heart rate." />
            <ExpectedSignalCard label="Deep Sleep" expected="+15–30%" direction="up" description="Core temp drop after sauna triggers deeper slow-wave sleep via thermoregulatory pathways." />
          </div>
        </Section>

        <Separator />

        <Section title="Conclusion Card">
          <div className="flex flex-col gap-4">
            <ConclusionCard title="What worked" variant="positive" items={[{ icon: "↑", text: "HRV +15.7% — well above ±4% normal variation." }, { icon: "↑", text: "Deep sleep +18.2% — evening timing was key." }]} />
            <ConclusionCard title="What didn't change" variant="neutral" items={[{ icon: "→", text: "Respiratory rate -2.6% — within normal variation." }]} />
            <ConclusionCard title="Key insights" variant="insight" items={[{ icon: "•", text: "Evening sessions drove sleep gains. Morning sessions showed no benefit." }, { icon: "•", text: "2–3x/week appears sufficient. Skipping one session had no negative impact." }]} />
            <ConclusionCard title="Recommendations" variant="recommendation" items={[{ icon: "→", text: "Continue sauna 2x/week as maintenance." }, { icon: "→", text: "Add cold exposure post-sauna for contrast protocol." }]} />
          </div>
        </Section>

        <Separator />

        <Section title="Health data consent actions">
          <HealthDataConsentControlStudy />
        </Section>

        <Separator />

        <Section title="Data export">
          <DataExportControlStudy />
        </Section>

        <Separator />

        <Section title="Health Domain Card">
          <div className="grid grid-cols-2 gap-4">
            <HealthDomainCard title="Sleep & Recovery" description="Deep sleep and HRV below your potential." score={42} status="biggest-opportunity" statusLabel="Biggest opportunity" secondaryInfo="3 experiments available" />
            <HealthDomainCard title="Cardiovascular & Fitness" description="RHR decent but flat. Zone 2 experiment running." score={64} status="experiment-active" statusLabel="Experiment active" secondaryInfo="Zone 2 RHR Reset · Day 14" />
            <HealthDomainCard title="Supplements" description="No experiments run yet." score={null} status="not-started" statusLabel="Not started" secondaryInfo="5 experiments available" />
            <HealthDomainCard title="Stress & Calm" description="HRV patterns suggest elevated baseline stress." score={35} status="worth-attention" statusLabel="Worth attention" secondaryInfo="4 experiments available" />
          </div>
        </Section>

        <Separator />

        <Section title="Plan Visual">
          <div className="flex items-end gap-8">
            <div className="flex flex-col items-center gap-2">
              <PlanVisual tier="free" />
              <span className="text-xs text-muted-foreground">Free</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <PlanVisual tier="pulse" />
              <span className="text-xs text-muted-foreground">Pulse</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <PlanVisual tier="edge" />
              <span className="text-xs text-muted-foreground">Edge</span>
            </div>
          </div>
        </Section>

        <Separator />

        <Section title="Plan selling points">
          <p className="-mt-3 text-xs text-muted-foreground">
            Canonical bullet lists from lib/hosted-onboarding/plan-features.ts. The join page,
            billing settings, and the plan dialogs all render from these lists, so a wording
            change here is the wording change everywhere. Only Edge may claim the most capable
            AI models; the top model requires an active paid Edge plan.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <PlanBulletListStudy title="Pulse trial · join page" features={PULSE_TRIAL_FEATURES} />
            <PlanBulletListStudy title="Pulse · join page" features={JOIN_PULSE_FEATURES} />
            <PlanBulletListStudy title="Edge · join page" features={JOIN_EDGE_FEATURES} />
            <PlanBulletListStudy title="Family · join page" features={JOIN_FAMILY_FEATURES} />
            <PlanBulletListStudy title="Core · settings" features={SETTINGS_CORE_FEATURES} />
            <PlanBulletListStudy title="Pulse · settings" features={SETTINGS_PULSE_FEATURES} />
            <PlanBulletListStudy title="Edge · settings" features={SETTINGS_EDGE_FEATURES} />
            <PlanBulletListStudy title="Family · settings" features={SETTINGS_FAMILY_FEATURES} />
            <PlanBulletListStudy
              title="Pulse · start-paid dialog"
              features={CHECKOUT_PULSE_FEATURES}
            />
            <PlanBulletListStudy
              title="Core · start-paid dialog"
              features={CHECKOUT_CORE_FEATURES}
            />
            <PlanBulletListStudy
              title="Edge loses · downgrade dialog"
              features={EDGE_ONLY_FEATURES}
            />
          </div>
        </Section>

        <Section title="Trial Billing Banner">
          <p className="-mt-3 text-xs text-muted-foreground">
            Shown on Home when a Pulse trial is paused with billing still attached. It is the
            dashboard&apos;s only billing-recovery action, which is why lapsed members are sent
            to the Subscription controls rather than here.
          </p>
          <TrialBillingBanner />
        </Section>

        <Separator />

        <Section title="Active Experiment Banner & Profile Stats">
          <div className="flex items-stretch gap-4">
            <div className="flex-1"><ActiveExperimentBanner id="demo" title="Zone 2 RHR Reset" day={14} totalDays={28} /></div>
            <ProfileStats completed={2} daysTracked={47} />
          </div>
        </Section>

        <Separator />

        <Section title="Floating Island">
          <p className="-mt-3 text-xs text-muted-foreground">
            Used on the computer handoff page to confirm a manual browser step. Drag the chip by the icon.
          </p>
          <div className="relative h-64 overflow-hidden rounded-2xl bg-foreground">
            <div className="absolute inset-x-0 bottom-0 flex justify-center px-3 pb-4">
              <ComputerHandoffFloatingIsland persistKey={null}
                handle={
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Monitor className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  </span>
                }
              >
                <Button size="lg" type="button">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Done
                </Button>
              </ComputerHandoffFloatingIsland>
            </div>
          </div>
        </Section>
      </div>
    </TooltipProvider>
  );
}

async function acceptDesignDashboardConsentScope(
  input: HostedLegalConsentAcceptanceInput,
): Promise<HostedConsentStatus> {
  const scopes = input.currentStatus.scopes.map((scopeStatus) => {
    if (scopeStatus.scope !== input.scope) {
      return scopeStatus;
    }

    return {
      ...scopeStatus,
      current: true,
      grant: {
        documentVersions: input.acceptedDocumentVersions,
        grantedAt: input.currentStatus.generatedAt,
        lastEventId: null,
        revokedAt: null,
        scope: input.scope,
        source: "design-preview",
        status: "granted" as const,
        updatedAt: input.currentStatus.generatedAt,
      },
      granted: true,
      missingDocuments: [],
    };
  });
  const launchScopes = input.currentStatus.launchScopes.map((scopeStatus) => (
    scopeStatus.scope === input.scope
      ? { ...scopeStatus, granted: true, missingDocuments: [] }
      : scopeStatus
  ));

  return {
    ...input.currentStatus,
    launchGranted: launchScopes.every((scopeStatus) => scopeStatus.granted),
    launchScopes,
    scopes,
  };
}

function completeDesignDashboardConsentPreview(): void {
  // The public component catalog demonstrates the accepted handoff state
  // without invoking navigation or production consent authority.
}
