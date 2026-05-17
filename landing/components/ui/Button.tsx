"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "quiet";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-alabaster-grey hover:bg-deep-space-blue",
  secondary:
    "border border-accent/40 text-accent hover:bg-accent/[0.06]",
  ghost:
    "text-ink-soft hover:text-accent hover:bg-accent/[0.06]",
  quiet:
    "border border-line text-ink-soft hover:text-accent hover:border-accent/40",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[13px] rounded-md",
  md: "h-11 px-5 text-sm rounded-md",
  lg: "h-12 px-6 text-[15px] rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
        "disabled:opacity-50 disabled:pointer-events-none",
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
