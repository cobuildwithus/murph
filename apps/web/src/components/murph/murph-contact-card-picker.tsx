"use client";

import { useId, useState } from "react";
import { ContactRoundIcon } from "lucide-react";

import { Button, buttonVariants } from "@/src/components/ui/button";
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
import {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  findMurphContactAvatarOption,
  MURPH_CONTACT_AVATAR_OPTIONS,
  type MurphContactAvatarKind,
  type MurphContactAvatarOption,
} from "@/src/lib/murph-contact-avatars";
import { cn } from "@/src/lib/utils";

export {
  DEFAULT_MURPH_CONTACT_AVATAR_ID,
  findMurphContactAvatarOption,
  MURPH_CONTACT_AVATAR_OPTIONS,
  type MurphContactAvatarKind,
  type MurphContactAvatarOption,
};

export function murphContactCardDownloadHref(avatarId: string): string {
  return `/api/murph-contact-card?avatar=${encodeURIComponent(avatarId)}`;
}

export function MurphContactAvatarArt({
  className,
  option,
}: {
  className?: string;
  option: MurphContactAvatarOption;
}) {
  if (option.src) {
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
      className="grid grid-cols-4 gap-x-2 gap-y-4"
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
      <MurphContactAvatarArt
        className="size-24 text-[96px] ring-1 ring-border"
        option={option}
      />
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
  onAddToContacts?: (option: MurphContactAvatarOption) => void;
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
      <div className="-mx-1 max-h-72 overflow-y-auto px-1 py-1">
        <MurphContactAvatarGrid onChange={setSelectedId} value={selectedId} />
      </div>
      <div className="flex flex-col gap-2">
        <a
          className={buttonVariants({ className: "w-full", size: "xl" })}
          download
          href={murphContactCardDownloadHref(selected.id)}
          onClick={() => onAddToContacts?.(selected)}
        >
          <ContactRoundIcon data-icon="inline-start" />
          Add Murph to Contacts
        </a>
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
        className="max-h-[calc(100dvh-2rem)] max-w-md gap-6 overflow-y-auto rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border md:p-7"
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
