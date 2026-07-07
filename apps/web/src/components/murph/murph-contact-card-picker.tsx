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
  DrawerFooter,
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
      className="grid grid-cols-3 gap-x-2 gap-y-4 min-[380px]:grid-cols-4"
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

/**
 * Self-contained "Add Murph to Contacts" button that opens the picker.
 * Drop-in for server components (signup success, settings) that just need
 * the entry point.
 */
export function MurphAddToContactsButton({
  size = "lg",
  variant = "outline",
}: {
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size={size} type="button" variant={variant}>
        Add Murph to Contacts
      </Button>
      <MurphContactCardPicker
        onAddToContacts={() => setOpen(false)}
        onOpenChange={setOpen}
        open={open}
      />
    </>
  );
}

const PICKER_TITLE = "Add Murph to your contacts";
const PICKER_DESCRIPTION =
  "Pick the photo Murph shows up with in your contacts. Same Murph either way.";
const DEFAULT_PICKER_COPY = {
  description: PICKER_DESCRIPTION,
  primaryAction: "Add Murph to Contacts",
  secondaryAction: "Skip for now",
  title: PICKER_TITLE,
};

export type MurphContactCardPickerCopy = Partial<typeof DEFAULT_PICKER_COPY>;

export function MurphContactCardPicker({
  copy,
  initialAvatarId = DEFAULT_MURPH_CONTACT_AVATAR_ID,
  onAddToContacts,
  onOpenChange,
  onSkip,
  open,
}: {
  copy?: MurphContactCardPickerCopy;
  initialAvatarId?: string;
  onAddToContacts?: (option: MurphContactAvatarOption) => void;
  onOpenChange: (open: boolean) => void;
  onSkip?: () => void;
  open: boolean;
}) {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState(initialAvatarId);
  const selected = findMurphContactAvatarOption(selectedId);
  const pickerCopy = {
    ...DEFAULT_PICKER_COPY,
    ...copy,
  };

  const actions = (
    <div className="flex flex-col gap-2">
      {/* No `download` attribute: the route serves the vCard inline so iOS
          Safari opens its native contact preview; a download hint would
          route it into Files instead. */}
      <a
        className={buttonVariants({ className: "w-full", size: "xl" })}
        href={murphContactCardDownloadHref(selected.id)}
        onClick={() => onAddToContacts?.(selected)}
      >
        <ContactRoundIcon data-icon="inline-start" />
        {pickerCopy.primaryAction}
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
        {pickerCopy.secondaryAction}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer onOpenChange={onOpenChange} open={open}>
        <DrawerContent className="h-[92dvh] max-h-[92dvh]">
          <DrawerHeader className="items-center text-center">
            <DrawerTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {pickerCopy.title}
            </DrawerTitle>
            <DrawerDescription className="text-sm leading-6 text-muted-foreground">
              {pickerCopy.description}
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1">
            <div className="flex flex-col gap-6">
              <MurphContactCardPreview option={selected} />
              <MurphContactAvatarGrid onChange={setSelectedId} value={selectedId} />
            </div>
          </div>
          <DrawerFooter className="border-t border-border px-4 pb-6 pt-3">
            {actions}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  const body = (
    <div className="flex flex-col gap-6">
      <MurphContactCardPreview option={selected} />
      <div className="-mx-1 max-h-[42dvh] overflow-y-auto px-1 py-1">
        <MurphContactAvatarGrid onChange={setSelectedId} value={selectedId} />
      </div>
      {actions}
    </div>
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-xl gap-6 overflow-y-auto rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border md:p-7"
        showCloseButton={false}
      >
        <DialogHeader className="items-center gap-2 text-center">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
            {pickerCopy.title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-muted-foreground">
            {pickerCopy.description}
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
