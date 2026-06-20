"use client";

import {
  forwardRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

interface MurphContactLinkProps
  extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "aria-label" | "href" | "rel" | "target"
  > {
  actionLabel: string;
  children?: ReactNode;
  option: MurphContactOption;
}

export const MurphContactLink = forwardRef<HTMLAnchorElement, MurphContactLinkProps>(
  function MurphContactLink({
    actionLabel,
    children,
    className,
    onClick,
    option,
    ...props
  }, ref) {
    const opensInNewTab = option.target === "_blank";
    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);

      if (event.defaultPrevented || !isTelegramAppTextHref(option.href)) {
        return;
      }

      event.preventDefault();
      window.location.assign(option.href);
    };

    return (
      <a
        {...props}
        ref={ref}
        className={className}
        href={option.href}
        target={option.target}
        rel={option.rel}
        onClick={handleClick}
        aria-label={`${actionLabel} in ${option.label}${
          opensInNewTab ? " (opens in a new tab)" : ""
        }`}
      >
        {children}
        {opensInNewTab ? <span className="sr-only"> Opens in a new tab.</span> : null}
      </a>
    );
  },
);

function isTelegramAppTextHref(href: string): boolean {
  return href.startsWith("tg://resolve?") && /[?&]text=/u.test(href);
}
