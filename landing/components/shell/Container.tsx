import * as React from "react";
import { cn } from "@/lib/cn";

export function Container({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-7xl px-5 md:px-8", className)}
      {...props}
    />
  );
}
