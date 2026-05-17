"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-md border border-line bg-bg-secondary/40 px-4 text-sm text-ink placeholder:text-ink-muted",
        "outline-none transition-colors duration-150",
        "focus:border-line-strong focus:bg-bg-secondary",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
