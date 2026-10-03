"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  MessageCircle,
  Pencil,
  Plus,
  Send,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/src/components/ui/avatar";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/src/components/ui/field";
import { Input } from "@/src/components/ui/input";
import { PageHeader } from "@/src/components/ui/page-header";
import { Progress } from "@/src/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Separator } from "@/src/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/src/components/ui/sheet";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";

type GroupChannel = "imessage" | "telegram";
type GroupRole = "member" | "owner";
type GroupModel = "Luna" | "Sol" | "Terra";
type GroupStyle = "Direct" | "Friendly referee" | "Quiet observer";

interface PrototypeMember {
  id: string;
  name: string;
  role: GroupRole;
}

interface PrototypeGroup {
  channel: GroupChannel;
  context: string;
  funding: "Sponsored" | "Not sponsored";
  id: string;
  members: PrototypeMember[];
  model: GroupModel;
  role: GroupRole;
  style: GroupStyle;
  supporters: string[];
  title: string;
  usageUsedPercent: number;
}

const INITIAL_GROUPS: PrototypeGroup[] = [
  {
    channel: "imessage",
    context:
      "Morning training group. Keep plans short and practical. Sunday is the weekly review. Avoid leaderboards and compare routines, not people.",
    funding: "Sponsored",
    id: "morning-club",
    members: [
      { id: "you", name: "You", role: "owner" },
      { id: "ari", name: "Ari", role: "member" },
      { id: "sam", name: "Sam", role: "member" },
      { id: "maya", name: "Maya", role: "member" },
      { id: "leo", name: "Leo", role: "member" },
      { id: "nina", name: "Nina", role: "member" },
    ],
    model: "Sol",
    role: "owner",
    style: "Friendly referee",
    supporters: ["The early bird", "Anonymous"],
    title: "Morning club",
    usageUsedPercent: 68,
  },
  {
    channel: "telegram",
    context:
      "A running group for Warsaw. Answer training questions when asked and keep route planning concise.",
    funding: "Not sponsored",
    id: "warsaw-runners",
    members: [
      { id: "ola", name: "Ola", role: "owner" },
      { id: "you", name: "You", role: "member" },
      { id: "tomek", name: "Tomek", role: "member" },
      { id: "iga", name: "Iga", role: "member" },
      { id: "max", name: "Max", role: "member" },
    ],
    model: "Luna",
    role: "member",
    style: "Direct",
    supporters: [],
    title: "Warsaw runners",
    usageUsedPercent: 41,
  },
  {
    channel: "imessage",
    context:
      "Friends planning one dinner each week. Help with simple options and remember dietary constraints shared in this chat.",
    funding: "Sponsored",
    id: "sunday-dinner",
    members: [
      { id: "jo", name: "Jo", role: "owner" },
      { id: "you", name: "You", role: "member" },
      { id: "eli", name: "Eli", role: "member" },
      { id: "liv", name: "Liv", role: "member" },
    ],
    model: "Sol",
    role: "member",
    style: "Quiet observer",
    supporters: ["Sunday host"],
    title: "Sunday dinner",
    usageUsedPercent: 23,
  },
  {
    channel: "telegram",
    context:
      "A small sleep experiment group. Focus on weekly patterns and call out uncertainty. Do not rank members by sleep scores.",
    funding: "Not sponsored",
    id: "sleep-lab",
    members: [
      { id: "you", name: "You", role: "owner" },
      { id: "ada", name: "Ada", role: "member" },
      { id: "jan", name: "Jan", role: "member" },
    ],
    model: "Terra",
    role: "owner",
    style: "Direct",
    supporters: [],
    title: "Sleep lab",
    usageUsedPercent: 84,
  },
];

const MODEL_OPTIONS: GroupModel[] = ["Luna", "Sol", "Terra"];
const STYLE_OPTIONS: GroupStyle[] = [
  "Direct",
  "Friendly referee",
  "Quiet observer",
];

export function GroupsWorkspacePrototype({
  initialSelectedGroupId = "morning-club",
}: {
  initialSelectedGroupId?: string;
}) {
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [selectedGroupId, setSelectedGroupId] = useState(
    initialSelectedGroupId,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [connectStep, setConnectStep] = useState<
    "choose" | "imessage" | "telegram"
  >("choose");
  const [imessagePrepared, setImessagePrepared] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? groups[0],
    [groups, selectedGroupId],
  );

  if (!selectedGroup) {
    return null;
  }

  function openConnectDialog() {
    setConnectStep("choose");
    setImessagePrepared(false);
    setConnectOpen(true);
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Shared rooms
              <Badge variant="outline">Local prototype</Badge>
            </span>
          }
          title="Groups"
          description="See the groups you belong to across Messages and Telegram."
        />
        <Button
          className="self-start sm:self-auto"
          onClick={openConnectDialog}
          type="button"
        >
          <Plus data-icon="inline-start" />
          Connect a group
        </Button>
      </div>

      {notice ? (
        <p aria-live="polite" className="text-sm text-primary" role="status">
          {notice}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border bg-card lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
        <GroupList
          groups={groups}
          onSelect={(groupId) => {
            setSelectedGroupId(groupId);
            setNotice(null);
          }}
          selectedGroupId={selectedGroup.id}
        />

        <GroupDetail
          group={selectedGroup}
          onEdit={() => setEditOpen(true)}
          onFunding={() => setFundingOpen(true)}
          onLeave={() => {
            setNotice(
              "Leave group is shown here, but this prototype does not change membership.",
            );
          }}
        />
      </section>

      <EditGroupSheet
        group={selectedGroup}
        key={selectedGroup.id}
        onOpenChange={setEditOpen}
        onSave={(nextGroup) => {
          setGroups((current) =>
            current.map((group) =>
              group.id === nextGroup.id ? nextGroup : group,
            ),
          );
          setEditOpen(false);
          setNotice("Group settings updated in this prototype.");
        }}
        open={editOpen}
      />

      <ConnectGroupDialog
        imessagePrepared={imessagePrepared}
        onOpenChange={setConnectOpen}
        onPrepareImessage={() => setImessagePrepared(true)}
        onStepChange={setConnectStep}
        open={connectOpen}
        step={connectStep}
      />

      <FundingDialog
        group={selectedGroup}
        onOpenChange={setFundingOpen}
        open={fundingOpen}
      />
    </div>
  );
}

function GroupList({
  groups,
  onSelect,
  selectedGroupId,
}: {
  groups: PrototypeGroup[];
  onSelect: (groupId: string) => void;
  selectedGroupId: string;
}) {
  return (
    <nav
      aria-label="Your groups"
      className="border-b border-border bg-muted/15 lg:border-b-0 lg:border-r"
    >
      <div className="flex items-center justify-between px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Your groups
        </p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {groups.length}
        </span>
      </div>
      <div className="flex overflow-x-auto border-t border-border lg:block lg:overflow-visible">
        {groups.map((group) => {
          const selected = group.id === selectedGroupId;
          return (
            <button
              aria-current={selected ? "page" : undefined}
              className={cn(
                "group flex min-h-20 min-w-64 items-center gap-3 border-r border-border px-4 py-3 text-left outline-none last:border-r-0 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 lg:w-full lg:min-w-0 lg:border-r-0 lg:border-b lg:last:border-b-0",
                selected ? "bg-primary/[0.07]" : "hover:bg-muted/35",
              )}
              key={group.id}
              onClick={() => onSelect(group.id)}
              type="button"
            >
              <Avatar size="lg">
                <AvatarFallback>{initials(group.title)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {group.title}
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ChannelIcon channel={group.channel} />
                  {channelLabel(group.channel)}
                  <span aria-hidden="true">·</span>
                  {roleLabel(group.role)}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0",
                  selected ? "text-primary" : "text-muted-foreground",
                )}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function GroupDetail({
  group,
  onEdit,
  onFunding,
  onLeave,
}: {
  group: PrototypeGroup;
  onEdit: () => void;
  onFunding: () => void;
  onLeave: () => void;
}) {
  const isOwner = group.role === "owner";

  return (
    <article className="min-w-0 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-9">
      <header className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              <ChannelIcon channel={group.channel} />
              {channelLabel(group.channel)}
            </span>
            <Badge variant="outline">{roleLabel(group.role)}</Badge>
          </div>
          <h2 className="mt-3 text-balance font-serif text-4xl font-semibold leading-tight tracking-[-0.03em] text-foreground">
            {group.title}
          </h2>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users aria-hidden="true" className="size-4" />
            {group.members.length} people
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onEdit} size="sm" type="button" variant="outline">
            <Pencil data-icon="inline-start" />
            {isOwner ? "Edit group" : "Edit Murph"}
          </Button>
          {!isOwner ? (
            <Button onClick={onLeave} size="sm" type="button" variant="ghost">
              Leave group
            </Button>
          ) : null}
        </div>
      </header>

      <DetailSection title="Context">
        <p className="max-w-3xl text-base leading-7 text-foreground/85">
          {group.context}
        </p>
        <dl className="mt-6 divide-y divide-border border-y border-border">
          <MetadataRow label="Model" value={group.model} />
          <MetadataRow label="Response style" value={group.style} />
        </dl>
      </DetailSection>

      <DetailSection title="People">
        <div className="divide-y divide-border border-y border-border">
          {group.members.map((member) => (
            <div
              className="flex min-h-14 items-center gap-3 py-3"
              key={member.id}
            >
              <Avatar>
                <AvatarFallback>{initials(member.name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {member.name}
              </span>
              <span className="text-sm text-muted-foreground">
                {roleLabel(member.role)}
              </span>
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection last title="Usage & funding">
        <div>
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium text-foreground">
              Included usage
            </p>
            <p className="text-sm tabular-nums text-muted-foreground">
              About {group.usageUsedPercent}% used
            </p>
          </div>
          <Progress
            aria-label={`${group.usageUsedPercent}% of included usage used`}
            className="mt-3"
            value={group.usageUsedPercent}
          />
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            This is an approximate share of the current included period. It is
            not a token count or a credit balance.
          </p>
        </div>

        <Separator className="my-7" />

        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {group.funding}
            </p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {group.funding === "Sponsored"
                ? supporterCopy(group.supporters)
                : "Anyone in the group can support its shared usage. Payment details stay private to the payer."}
            </p>
          </div>
          <Button
            className="self-start"
            onClick={onFunding}
            size="sm"
            type="button"
            variant="outline"
          >
            {group.funding === "Sponsored"
              ? "Funding details"
              : "Support group"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </DetailSection>
    </article>
  );
}

function DetailSection({
  children,
  last = false,
  title,
}: {
  children: ReactNode;
  last?: boolean;
  title: string;
}) {
  return (
    <section
      className={cn("py-8", !last && "border-b border-border")}
      aria-labelledby={`group-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <h3
        className="mb-5 font-serif text-2xl font-semibold tracking-[-0.02em] text-foreground"
        id={`group-${title.toLowerCase().replaceAll(" ", "-")}`}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-6 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right text-sm font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

function EditGroupSheet({
  group,
  onOpenChange,
  onSave,
  open,
}: {
  group: PrototypeGroup;
  onOpenChange: (open: boolean) => void;
  onSave: (group: PrototypeGroup) => void;
  open: boolean;
}) {
  const [draft, setDraft] = useState(group);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraft(group);
    }
    onOpenChange(nextOpen);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      ...draft,
      context: draft.context.trim(),
      title: draft.title.trim(),
    });
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <form className="flex min-h-full flex-col" onSubmit={handleSubmit}>
          <SheetHeader className="border-b border-border px-5 py-5">
            <SheetTitle className="text-xl">
              {group.role === "owner" ? "Edit group" : "Edit Murph"}
            </SheetTitle>
            <SheetDescription>
              {group.role === "owner"
                ? "Change the group title and its shared Murph settings."
                : "Change the shared Murph settings for this group."}{" "}
              These changes only update the local prototype.
            </SheetDescription>
          </SheetHeader>

          <FieldGroup className="flex-1 px-5 py-6">
            {group.role === "owner" ? (
              <Field>
                <FieldLabel htmlFor="group-title">Title</FieldLabel>
                <Input
                  id="group-title"
                  name="title"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  required
                  value={draft.title}
                />
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="group-context">Initial context</FieldLabel>
              <Textarea
                className="min-h-36 resize-y"
                id="group-context"
                name="context"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    context: event.target.value,
                  }))
                }
                required
                value={draft.context}
              />
              <FieldDescription>
                Murph uses this shared context inside this group.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="group-model">Model</FieldLabel>
              <Select
                name="model"
                onValueChange={(value) =>
                  value &&
                  setDraft((current) => ({
                    ...current,
                    model: value as GroupModel,
                  }))
                }
                value={draft.model}
              >
                <SelectTrigger id="group-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {MODEL_OPTIONS.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="group-style">Response style</FieldLabel>
              <Select
                name="style"
                onValueChange={(value) =>
                  value &&
                  setDraft((current) => ({
                    ...current,
                    style: value as GroupStyle,
                  }))
                }
                value={draft.style}
              >
                <SelectTrigger id="group-style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {STYLE_OPTIONS.map((style) => (
                      <SelectItem key={style} value={style}>
                        {style}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field data-disabled>
              <FieldLabel htmlFor="group-channel">Channel</FieldLabel>
              <Input
                disabled
                id="group-channel"
                name="channel"
                value={channelLabel(draft.channel)}
              />
              <FieldDescription>
                A connected group keeps its original channel.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <SheetFooter className="border-t border-border px-5 py-4">
            <Button
              disabled={!draft.title.trim() || !draft.context.trim()}
              type="submit"
            >
              Save changes
            </Button>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ConnectGroupDialog({
  imessagePrepared,
  onOpenChange,
  onPrepareImessage,
  onStepChange,
  open,
  step,
}: {
  imessagePrepared: boolean;
  onOpenChange: (open: boolean) => void;
  onPrepareImessage: () => void;
  onStepChange: (step: "choose" | "imessage" | "telegram") => void;
  open: boolean;
  step: "choose" | "imessage" | "telegram";
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto p-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {step === "choose"
              ? "Connect a group"
              : step === "imessage"
              ? "Connect an iMessage group"
              : "Connect a Telegram group"}
          </DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "Choose where the group already lives. Murph does not create the native chat from the web."
              : step === "imessage"
              ? "Prepare ownership here, then add Murph to one new group within 30 minutes."
              : "Create or open the group in Telegram, then add Murph there."}
          </DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          <div className="flex flex-col gap-3 py-2">
            <ChannelChoice
              body="Prepare one new Messages group for the next 30 minutes."
              channel="imessage"
              onClick={() => onStepChange("imessage")}
              title="iMessage"
            />
            <ChannelChoice
              body="Continue in Telegram and add Murph to the native chat."
              channel="telegram"
              onClick={() => onStepChange("telegram")}
              title="Telegram"
            />
          </div>
        ) : step === "imessage" ? (
          <div className="py-3">
            {imessagePrepared ? (
              <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <p className="font-medium text-foreground">
                    Ready for 30 minutes
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Add Murph to the new Messages group. The first matching chat
                    will use you as its owner.
                  </p>
                </div>
              </div>
            ) : (
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm leading-6 text-muted-foreground">
                <li>Prepare this one group.</li>
                <li>Create or open the group in Messages.</li>
                <li>Add Murph and send the first message within 30 minutes.</li>
              </ol>
            )}
          </div>
        ) : (
          <div className="py-3">
            <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm leading-6 text-muted-foreground">
              <li>Create or open a Telegram group.</li>
              <li>Add the Murph bot to that group.</li>
              <li>Send a message to finish setup in Telegram.</li>
            </ol>
          </div>
        )}

        <DialogFooter className="-mx-5 -mb-5 px-5 py-4">
          {step === "choose" ? (
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          ) : (
            <>
              <Button
                onClick={() => onStepChange("choose")}
                type="button"
                variant="outline"
              >
                Back
              </Button>
              {step === "imessage" && !imessagePrepared ? (
                <Button onClick={onPrepareImessage} type="button">
                  Prepare group
                </Button>
              ) : (
                <Button onClick={() => onOpenChange(false)} type="button">
                  {step === "telegram" ? "I’ll continue in Telegram" : "Done"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChannelChoice({
  body,
  channel,
  onClick,
  title,
}: {
  body: string;
  channel: GroupChannel;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className="flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left outline-none hover:bg-muted/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onClick}
      type="button"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ChannelIcon channel={channel} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">
          {body}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  );
}

function FundingDialog({
  group,
  onOpenChange,
  open,
}: {
  group: PrototypeGroup;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Usage & funding</DialogTitle>
          <DialogDescription>
            Shared funding for {group.title}. Payment details remain private to
            each payer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              {group.funding}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {group.supporters.length > 0
                ? supporterCopy(group.supporters)
                : "No supporter aliases are shown for this group."}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium text-foreground">
                Included usage
              </span>
              <span className="tabular-nums text-muted-foreground">
                About {group.usageUsedPercent}% used
              </span>
            </div>
            <Progress
              aria-label={`${group.usageUsedPercent}% of included usage used`}
              className="mt-3"
              value={group.usageUsedPercent}
            />
          </div>
        </div>
        <DialogFooter className="-mx-5 -mb-5 px-5 py-4">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Close
          </Button>
          <Button onClick={() => onOpenChange(false)} type="button">
            {group.funding === "Sponsored" ? "Add support" : "Support group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChannelIcon({ channel }: { channel: GroupChannel }) {
  const Icon = channel === "imessage" ? MessageCircle : Send;
  return <Icon aria-hidden="true" className="size-4 shrink-0" />;
}

function channelLabel(channel: GroupChannel): string {
  return channel === "imessage" ? "iMessage" : "Telegram";
}

function roleLabel(role: GroupRole): string {
  return role === "owner" ? "Owner" : "Member";
}

function initials(value: string): string {
  return value
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function supporterCopy(supporters: string[]): string {
  if (supporters.length === 0) {
    return "Supporter payment details stay private.";
  }
  if (supporters.length === 1) {
    return `Supported by ${supporters[0]}. Amounts and payment details stay private.`;
  }
  return `Supported by ${supporters.join(
    " and ",
  )}. Amounts and payment details stay private.`;
}
