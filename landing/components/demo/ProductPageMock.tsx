"use client";

import { Star, Heart, Package } from "lucide-react";
import { cn } from "@/lib/cn";

export function ProductPageMock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative w-full max-w-[520px] rounded-2xl bg-bg-secondary border border-line overflow-hidden",
        className,
      )}
    >
      <div className="h-9 flex items-center gap-1.5 px-4 bg-bg-tertiary/60 border-b border-line">
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <div className="ml-3 flex-1 max-w-xs rounded bg-bg-primary/60 px-2 py-0.5 text-[10px] text-ink-faint truncate">
          trendyol-demo.local / oversize-siyah-hoodie
        </div>
      </div>

      <div className="p-6 grid grid-cols-5 gap-5">
        <div className="col-span-2 aspect-square rounded-xl bg-bg-tertiary border border-line flex items-center justify-center">
          <Package className="h-12 w-12 text-ink-faint" strokeWidth={1} />
        </div>

        <div className="col-span-3 space-y-3">
          <div className="kicker">Giyim · Üst</div>
          <h4 className="font-display text-lg font-normal text-ink leading-tight tracking-tight">
            Oversize Siyah Hoodie
          </h4>
          <div className="flex items-center gap-2 text-[11px] text-ink-muted">
            <div className="flex items-center gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    "h-3 w-3",
                    i < 4 ? "fill-ink/80 text-ink/80" : "text-ink-faint",
                  )}
                />
              ))}
            </div>
            <span>4.7</span>
            <span className="text-ink-faint">·</span>
            <span>842 değerlendirme</span>
          </div>

          <div className="pt-1">
            <div className="text-[11px] text-ink-faint line-through">₺1.650</div>
            <div className="flex items-baseline gap-2.5">
              <span className="font-display text-2xl font-light text-ink">₺990</span>
              <span className="text-[11px] text-ink-muted">%40 indirim</span>
            </div>
          </div>

          <div className="text-[12px] text-ink-muted">Yarın kargoda · ücretsiz iade</div>

          <div className="flex gap-2 pt-2">
            <button className="flex-1 h-10 rounded-md bg-ink text-bg-primary text-[13px] font-medium">
              Sepete Ekle
            </button>
            <button className="h-10 w-10 rounded-md border border-line flex items-center justify-center">
              <Heart className="h-4 w-4 text-ink-soft" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
