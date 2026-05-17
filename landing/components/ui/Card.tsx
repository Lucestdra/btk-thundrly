import * as React from "react";
import { cn } from "@/lib/cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl border border-line bg-bg-secondary/50",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
