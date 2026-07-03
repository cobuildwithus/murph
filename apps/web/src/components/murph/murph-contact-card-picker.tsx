"use client";

import { useId, useState } from "react";
import { ContactRoundIcon } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/src/components/ui/drawer";
import { useIsMobile } from "@/src/hooks/use-mobile";
import { cn } from "@/src/lib/utils";

export type MurphContactAvatarKind = "headshot" | "logo" | "blank";

export interface MurphContactAvatarOption {
  id: string;
  kind: MurphContactAvatarKind;
  label: string;
  src?: string;
}

export const MURPH_CONTACT_AVATAR_OPTIONS: readonly MurphContactAvatarOption[] = [
  {
    id: "hooded",
    kind: "headshot",
    label: "Hooded",
    src: "/murph-headshots/murph-headshot-01-sm.png",
  },
  {
    id: "classic",
    kind: "headshot",
    label: "Classic",
    src: "/murph-headshots/murph-headshot-02-sm.png",
  },
  {
    id: "gremlin",
    kind: "headshot",
    label: "Gremlin",
    src: "/murph-headshots/murph-headshot-03-sm.png",
  },
  {
    id: "referee",
    kind: "headshot",
    label: "Referee",
    src: "/murph-headshots/murph-headshot-04-sm.png",
  },
  { id: "logo", kind: "logo", label: "Logo" },
  { id: "none", kind: "blank", label: "No photo" },
];

export const DEFAULT_MURPH_CONTACT_AVATAR_ID = "hooded";

export function findMurphContactAvatarOption(id: string): MurphContactAvatarOption {
  return (
    MURPH_CONTACT_AVATAR_OPTIONS.find((option) => option.id === id)
    ?? MURPH_CONTACT_AVATAR_OPTIONS[0]
  );
}

export function MurphContactAvatarArt({
  className,
  option,
}: {
  className?: string;
  option: MurphContactAvatarOption;
}) {
  if (option.kind === "headshot" && option.src) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "block shrink-0 overflow-hidden rounded-full bg-cover bg-center",
          className,
        )}
        style={{ backgroundImage: `url('${option.src}')` }}
      />
    );
  }

  if (option.kind === "logo") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#2d3436]",
          className,
        )}
      >
        <MurphLogoDotsMark className="h-[42%] w-auto" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#d4c4a8]",
        className,
      )}
    >
      <span className="font-serif text-[38%] font-semibold leading-none text-[#2d3436]">
        M
      </span>
    </span>
  );
}

export function MurphContactAvatarGrid({
  onChange,
  value,
}: {
  onChange: (id: string) => void;
  value: string;
}) {
  const groupName = useId();

  return (
    <div
      aria-label="Murph contact photo"
      className="grid grid-cols-3 gap-x-2 gap-y-4"
      role="radiogroup"
    >
      {MURPH_CONTACT_AVATAR_OPTIONS.map((option) => {
        const selected = option.id === value;
        return (
          <label
            className="group flex cursor-pointer flex-col items-center gap-2 rounded-xl px-1 py-1.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            key={option.id}
          >
            <input
              checked={selected}
              className="sr-only"
              name={groupName}
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            <MurphContactAvatarArt
              className={cn(
                "size-14 text-[56px] transition-shadow",
                selected
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-popover"
                  : "ring-1 ring-border group-hover:ring-primary/40",
              )}
              option={option}
            />
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.12em]",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function MurphContactCardPreview({
  option,
}: {
  option: MurphContactAvatarOption;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <MurphContactAvatarArt className="size-24 text-[96px]" option={option} />
      <div className="flex flex-col items-center gap-0.5">
        <p className="font-serif text-2xl font-semibold tracking-normal text-foreground">
          Murph
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Contact card
        </p>
      </div>
    </div>
  );
}

const PICKER_TITLE = "Add Murph to your contacts";
const PICKER_DESCRIPTION =
  "Pick the photo Murph shows up with in your contacts. Same Murph either way.";

export function MurphContactCardPicker({
  initialAvatarId = DEFAULT_MURPH_CONTACT_AVATAR_ID,
  onAddToContacts,
  onOpenChange,
  onSkip,
  open,
}: {
  initialAvatarId?: string;
  onAddToContacts: (option: MurphContactAvatarOption) => void;
  onOpenChange: (open: boolean) => void;
  onSkip?: () => void;
  open: boolean;
}) {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState(initialAvatarId);
  const selected = findMurphContactAvatarOption(selectedId);

  const body = (
    <div className="flex flex-col gap-6">
      <MurphContactCardPreview option={selected} />
      <MurphContactAvatarGrid onChange={setSelectedId} value={selectedId} />
      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          onClick={() => onAddToContacts(selected)}
          size="xl"
          type="button"
        >
          <ContactRoundIcon data-icon="inline-start" />
          Add Murph to Contacts
        </Button>
        <Button
          className="w-full"
          onClick={() => {
            onSkip?.();
            onOpenChange(false);
          }}
          size="xl"
          type="button"
          variant="ghost"
        >
          Skip for now
        </Button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer onOpenChange={onOpenChange} open={open}>
        <DrawerContent>
          <DrawerHeader className="items-center text-center">
            <DrawerTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {PICKER_TITLE}
            </DrawerTitle>
            <DrawerDescription className="text-sm leading-6 text-muted-foreground">
              {PICKER_DESCRIPTION}
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-8">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-md gap-6 rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border md:p-7"
        showCloseButton={false}
      >
        <DialogHeader className="items-center gap-2 text-center">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
            {PICKER_TITLE}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-muted-foreground">
            {PICKER_DESCRIPTION}
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function MurphLogoDotsMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 65 44"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="6.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="16.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="27" cy="5.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="38" cy="5.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="48.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="58.5" cy="5.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="4.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="14.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="26" cy="15.5" fill="#a07a4e" r="3.5" />
      <circle cx="39" cy="15.5" fill="#a07a4e" r="3.5" />
      <circle cx="50.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="60.5" cy="15.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="2" cy="27.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="12.5" cy="27.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="25" cy="27.5" fill="#8b6840" r="4" />
      <circle cx="39.5" cy="27.5" fill="#8b6840" r="4.5" />
      <circle cx="52.5" cy="27.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="63" cy="27.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="6.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="16.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="27" cy="38.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="38" cy="38.5" fill="#c4956a" fillOpacity=".55" r="2.5" />
      <circle cx="48.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
      <circle cx="58.5" cy="38.5" fill="#b5c4a1" fillOpacity=".3" r="2" />
    </svg>
  );
}
