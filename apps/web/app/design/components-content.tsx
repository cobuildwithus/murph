"use client";

import { useState } from "react";
import { CheckCircle2, Monitor } from "lucide-react";
import { ComputerHandoffFloatingIsland } from "@/src/components/computer-use/computer-handoff-floating-island";
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
import { HealthDomainCard } from "@/src/components/overview/health-domain-card";
import { ActiveExperimentBanner } from "@/src/components/overview/active-experiment-banner";
import { ProfileStats } from "@/src/components/overview/profile-stats";
import { HostedAuthFinishingNotice } from "@/src/components/hosted-onboarding/hosted-auth-shared";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import { AuthButton } from "@/src/components/ui/auth-button";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";
import { Button } from "@/src/components/ui/button";
import { PaymentButton } from "@/src/components/ui/payment-button";
import { Badge } from "@/src/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Progress } from "@/src/components/ui/progress";
import { Separator } from "@/src/components/ui/separator";
import { Input } from "@/src/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/src/components/ui/input-otp";
import { Label } from "@/src/components/ui/label";
import { Skeleton } from "@/src/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { Alert, AlertTitle, AlertDescription } from "@/src/components/ui/alert";
import { Toggle } from "@/src/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";
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
  MURPH_CONTACT_AVATAR_OPTIONS,
  MurphContactAvatarArt,
  MurphContactAvatarGrid,
  MurphContactCardPicker,
  type MurphContactAvatarOption,
} from "@/src/components/murph/murph-contact-card-picker";
import type { ExperimentStartContactOption } from "@/src/lib/experiments/start-experiment-contact";
import { MURPH_TELEGRAM_URL } from "@/src/lib/murph-contact-routing";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function DialogPreviewFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div className="rounded-2xl bg-[#FAF8F4] p-6 shadow-[0_1px_2px_rgba(26,31,22,0.04)] ring-1 ring-[#1A1F16]/[0.06]">
        <p className="font-serif text-xl font-semibold tracking-tight text-[#1A1F16]">
          Log in or sign up
        </p>
        <p className="mt-1 text-sm text-[#5C5A52]">
          Discover what actually makes you healthier.
        </p>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}


const EXPERIMENT_START_CHANNEL_OPTIONS: ExperimentStartContactOption[] = [
  {
    connected: true,
    description: "Open Messages with the note ready to send.",
    href: "sms:?body=I%20want%20to%20start%20the%20Finnish%20Dry%20Sauna%20experiment.",
    kind: "text",
    label: "Text",
    meta: "Messages",
  },
  {
    connected: true,
    description: "Open Telegram with Murph.",
    href: MURPH_TELEGRAM_URL,
    kind: "telegram",
    label: "Telegram",
    meta: "Telegram",
  },
  {
    connected: true,
    description: "Open an email draft to Murph.",
    href: "mailto:murph@mail.withmurph.ai",
    kind: "email",
    label: "Email",
    meta: "Email",
  },
];

export function ComponentsContent() {
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);
  const [contactCardPickerOpen, setContactCardPickerOpen] = useState(false);
  const [addedContactAvatar, setAddedContactAvatar] =
    useState<MurphContactAvatarOption | null>(null);
  const [inlineContactAvatarId, setInlineContactAvatarId] = useState("hooded");

  return (
    <TooltipProvider>
      <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-12 sm:px-10 lg:px-16">
        <div>
          <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">Components</h1>
          <p className="mt-2 text-sm text-muted-foreground">Shadcn base UI + custom Murph components. Colors and typography live in the Brand tab.</p>
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
          <div className="grid max-w-sm gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email-ds">Email</Label>
              <Input id="email-ds" type="email" placeholder="you@example.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="disabled-ds">Disabled</Label>
              <Input id="disabled-ds" placeholder="Can't edit this" disabled />
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

        <Section title="Auth Finishing Notice">
          <p className="text-sm text-muted-foreground">
            Shown inside the sign-in dialog while the account is being provisioned.
            The animated Murph mark ripples outward from its warm center — core dots
            breathe first, mid amber ring trails by 200ms, sage outer ring by 400ms.
          </p>
          <div className="max-w-md">
            <DialogPreviewFrame label="In dialog context">
              <HostedAuthFinishingNotice />
            </DialogPreviewFrame>
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
            <Alert><AlertTitle>Experiment in progress</AlertTitle><AlertDescription>Day 8 of 21. Next session scheduled for this evening.</AlertDescription></Alert>
            <Alert variant="destructive"><AlertTitle>Oura disconnected</AlertTitle><AlertDescription>Reconnect your ring to continue tracking metrics.</AlertDescription></Alert>
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
              <DialogHeader><DialogTitle>Start Experiment</DialogTitle><DialogDescription>This will begin a 7-day baseline period followed by 14 days of active tracking.</DialogDescription></DialogHeader>
              <div className="flex justify-end gap-2 pt-4"><Button variant="outline">Cancel</Button><Button>Confirm</Button></div>
            </DialogContent>
          </Dialog>
        </Section>

        <Separator />

        <Section title="Experiment Start Channel Picker">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-serif text-xl font-semibold tracking-normal text-foreground">
                Start from the app you already use
              </p>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                If several apps are connected, choose where this experiment
                begins. Murph opens the app and prepares a note when the
                channel supports it.
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
            protocolTitle="Finnish Dry Sauna"
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
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">Baseline · 7d ✓</span>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">Active · Day 1 of 14</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Analysis</span>
            </div>
            <Progress value={38} className="h-1.5" />
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
              <TimelineEntry date="Apr 5" label="End" title="Experiment ends" description="Final analysis generated" variant="default" upcoming />
              <TimelineEntry date="Apr 1" label="Checkpoint" title="Week 2 review" variant="outline" upcoming />
              <TimelineEntry date="Mar 31" label="Upcoming" title="Session 3 of 3" upcoming />
              <TimelineEntry date="Mar 30" label="Today" title="Session logged" description="20 min at 85°C. Deep sleep was 1h50m last night." />
              <TimelineEntry date="Mar 29" title="HRV milestone" description="HRV crossed 50ms for the first time." />
              <TimelineEntry date="Mar 28" title="Skipped session" description="Feeling unwell, rest day." variant="muted" />
              <TimelineEntry date="Mar 25" label="Checkpoint" title="Week 1 complete" description="Baseline captured. Active phase started." variant="outline" />
              <TimelineEntry date="Mar 18" label="Start" title="Experiment started" description="Finnish Sauna Protocol · 21 days" variant="primary" last />
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
