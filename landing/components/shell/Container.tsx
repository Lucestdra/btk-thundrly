import * as React from "react";
import { cn } from "@/lib/cn";

export function Container({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Mobile padding tuned for 360–390px phones: 16px is the comfortable
      // safe-area margin most TR-shipped phones expect. md+ keeps the
      // wider gutter for the desktop layout.
      className={cn("mx-auto w-full max-w-7xl px-4 sm:px-5 md:px-8", className)}
      {...props}
    />
  );
}
