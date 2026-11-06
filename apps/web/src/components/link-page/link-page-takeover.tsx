"use client";

import { useLayoutEffect, type ComponentProps, type ReactNode } from "react";

import {
  LinkPageNightGround,
  LinkPageSurface,
} from "@/src/components/link-page/link-page-shell";
import { releaseLinkPageVeil } from "@/src/components/link-page/link-page-veil";
import { Dialog, DialogContent } from "@/src/components/ui/dialog";

function LinkPageVeilRelease() {
  useLayoutEffect(releaseLinkPageVeil, []);
  return null;
}

/**
 * A link page that shares its URL with a dashboard page, so it cannot replace
 * the dashboard frame. It covers the frame instead, and keeps focus and screen
 * readers out of what sits beneath it.
 */
export function LinkPageTakeover({
  children,
  label,
  onOpenChange,
  open = true,
  ...props
}: Omit<ComponentProps<typeof DialogContent>, "aria-label" | "children" | "className"> & {
  children: ReactNode;
  label: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        {...props}
        aria-label={label}
        className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-none bg-[#1C1915] p-0 text-[#FFFCF6] ring-0 duration-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
        showCloseButton={false}
      >
        <LinkPageNightGround />
        <LinkPageVeilRelease />
        <LinkPageSurface>{children}</LinkPageSurface>
      </DialogContent>
    </Dialog>
  );
}
