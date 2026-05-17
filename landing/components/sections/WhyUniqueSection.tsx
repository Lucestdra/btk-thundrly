"use client";

import { motion } from "framer-motion";
import { Check, X, Minus } from "lucide-react";
import { Container } from "@/components/shell/Container";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Cell = "full" | "partial" | "none";

const rows: { label: string; us: Cell; pricer: Cell; reviewer: Cell }[] = [
  { label: "Yorum güvenilirlik analizi", us: "full", pricer: "none", reviewer: "full" },
  { label: "Fiyat manipülasyonu tespiti", us: "full", pricer: "full", reviewer: "none" },
  { label: "Kişisel bütçe bağlamı", us: "full", pricer: "none", reviewer: "none" },
  { label: "Dürtüsel alışveriş riski", us: "full", pricer: "none", reviewer: "none" },
  { label: "Türk e-ticaret odaklı", us: "full", pricer: "partial", reviewer: "partial" },
  { label: "Türkçe doğal dil açıklama", us: "full", pricer: "partial", reviewer: "none" },
];

function CellIcon({ value }: { value: Cell }) {
  if (value === "full") return <Check className="h-4 w-4 text-ink" strokeWidth={2} />;
  if (value === "partial") return <Minus className="h-4 w-4 text-ink-muted" strokeWidth={2} />;
  return <X className="h-4 w-4 text-ink-faint" strokeWidth={1.5} />;
}

export function WhyUniqueSection() {
  return (
    <section className="fullscreen border-t border-line">
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
            Parçalı çözümleri <span className="italic">tek ekranda birleştirir</span>.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 lead max-w-2xl">
            Mevcut araçlar tek bir sorunu çözmeye çalışıyor. Tartı altı boyutu birden
            değerlendirip Türk e-ticaret alışkanlıklarına göre tasarlanmıştır.
          </motion.p>
        </motion.div>

        {/* Desktop table */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          className="hidden md:block"
        >
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line-strong">
                <th className="text-left py-5 pr-6 kicker">Boyut</th>
                <th className="py-5 px-4 kicker text-center font-medium">Fiyat takipçileri</th>
                <th className="py-5 px-4 kicker text-center font-medium">Yorum araçları</th>
                <th className="py-5 px-4 kicker text-center font-medium text-ink">Tartı</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line">
                  <td className="py-5 pr-6 text-[15px] text-ink-soft font-display font-normal">{r.label}</td>
                  <td className="py-5 px-4 text-center"><div className="inline-flex"><CellIcon value={r.pricer} /></div></td>
                  <td className="py-5 px-4 text-center"><div className="inline-flex"><CellIcon value={r.reviewer} /></div></td>
                  <td className="py-5 px-4 text-center"><div className="inline-flex"><CellIcon value={r.us} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-px bg-line">
          {rows.map((r) => (
            <motion.div
              key={r.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              className="bg-bg-primary p-4"
            >
              <div className="text-[14px] font-medium text-ink mb-3 font-display">{r.label}</div>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="flex flex-col items-center gap-1.5">
                  <CellIcon value={r.pricer} />
                  <span className="text-ink-muted leading-tight text-center">Fiyat</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <CellIcon value={r.reviewer} />
                  <span className="text-ink-muted leading-tight text-center">Yorum</span>
                </div>
                <div className="flex flex-col items-center gap-1.5 py-1.5 border border-line-strong rounded">
                  <CellIcon value={r.us} />
                  <span className="text-ink leading-tight text-center">Biz</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
