"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/shell/Container";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";
import { decisionLabel, decisionTone } from "@/lib/palette";
import {
  greenBookRequest,
  greenBookResponse,
  redHoodieRequest,
  redHoodieResponse,
  yellowHeadphonesRequest,
  yellowHeadphonesResponse,
} from "@shared/demo/demoPayloads";
import { cn } from "@/lib/cn";

const samples = [
  { request: greenBookRequest, response: greenBookResponse },
  { request: yellowHeadphonesRequest, response: yellowHeadphonesResponse },
  { request: redHoodieRequest, response: redHoodieResponse },
];

const fmt = new Intl.NumberFormat("tr-TR");

export function VerdictShowcaseSection() {
  return (
    <section id="ornekler" className="fullscreen border-t border-line">
      <Container>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="max-w-3xl mb-12 md:mb-16"
        >
          <motion.h2
            variants={fadeUp}
            className="font-display text-3xl md:text-5xl lg:text-6xl font-light leading-[1.05] tracking-tighter text-ink text-balance"
          >
            Üç ürün, <span className="italic">üç farklı karar</span>.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 lead max-w-2xl">
            Aynı motorun gerçek ürünler için ürettiği örnek kararlar. Karar rengi, ağırlıklı
            risk puanı ve gerekçeleri bir bakışta görürsün.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="grid md:grid-cols-3 gap-5 md:gap-6"
        >
          {samples.map((s) => {
            const tone = decisionTone[s.response.decision];
            const r = s.request;
            const discountPct = r.product.originalPrice
              ? Math.round(
                  (1 - r.product.price / r.product.originalPrice) * 100,
                )
              : 0;
            return (
              <motion.div
                key={r.product.title}
                variants={fadeUp}
                className={cn(
                  "card-elevated p-6 md:p-7 flex flex-col border-t-[3px]",
                  s.response.decision === "green" && "border-t-verdict-green",
                  s.response.decision === "yellow" && "border-t-verdict-yellow",
                  s.response.decision === "red" && "border-t-verdict-red",
                )}
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="min-w-0">
                    <div className="kicker mb-1.5">{r.product.category}</div>
                    <h3 className="font-display text-lg font-normal text-ink leading-tight tracking-tight">
                      {r.product.title}
                    </h3>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-display text-[20px] font-medium text-ink">
                        ₺{fmt.format(r.product.price)}
                      </span>
                      {r.product.originalPrice &&
                        r.product.originalPrice > r.product.price && (
                          <span className="text-[12px] text-ink-faint line-through">
                            ₺{fmt.format(r.product.originalPrice)}
                          </span>
                        )}
                      {discountPct > 0 && (
                        <span className="text-[11px] text-ink-muted">
                          %{discountPct}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="kicker mb-1">Risk</div>
                    <div className="font-display text-2xl font-light text-ink tracking-tight">
                      {s.response.riskScore}
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    "inline-flex items-center gap-2 self-start rounded-md border px-3 py-1.5 mb-5",
                    tone.bg,
                    tone.border,
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
                  <span
                    className={cn(
                      "text-[12px] font-medium tracking-wide",
                      tone.text,
                    )}
                  >
                    {decisionLabel[s.response.decision]}
                  </span>
                </div>

                <p className="text-[14px] text-ink-soft leading-relaxed mb-5">
                  {s.response.summary}
                </p>

                <ul className="space-y-2.5 mt-auto">
                  {s.response.reasons.map((reason, i) => (
                    <li
                      key={i}
                      className="flex gap-2.5 text-[13px] leading-relaxed text-ink-soft"
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-1 w-1 shrink-0 rounded-full",
                          tone.dot,
                        )}
                      />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </motion.div>
      </Container>
    </section>
  );
}
