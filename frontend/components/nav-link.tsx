"use client";

import type { ComponentProps } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

// A navigation link that shows when its page is the current one
export function NavLink({
  href,
  className,
  ...props
}: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-accent-soft text-accent-text"
          : "text-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
