"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/shell/Container";
import { Card } from "@/components/ui/Card";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

const problems = [
  {
    n: "01",
    title: "Sahte indirimler",
    body:
      "Fiyatlar indirim öncesi yükseltiliyor, %50 etiketi gerçek bir tasarruf olmuyor. Kullanıcı kandırıldığını çoğu zaman fark etmiyor.",
    stat: "%63",
    statLabel: "kampanyada gerçek indirim oranı %15'in altında",
  },
  {
    n: "02",
    title: "Manipüle edilmiş yorumlar",
    body:
      "Aynı cümleler farklı hesaplardan tekrar ediyor; 5 yıldız + tek satır yorum patlamaları yaşanıyor. Gerçek kullanıcı yorumlarını ayırt etmek zor.",
    stat: "4/10",
    statLabel: "yorum şüpheli örüntüler içeriyor (sentetik MVP analizi)",
  },
  {
    n: "03",
    title: "Dürtüsel alışveriş",
    body:
      "Geç saatte hızla verilen kararlar, kampanya bombardımanı, kategori bütçesinin sürekli aşılması. Üç gün sonra gelen pişmanlık alışverişi en yaygın iade nedeni.",
    stat: "%41",
    statLabel: "online alışverişler dürtüsel olarak başlıyor",
  },
];

export function ProblemSection() {
  return (
    <section id="sorun" className="fullscreen border-t border-line">
      <Container>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="max-w-3xl mb-16 md:mb-20"
        >
          <motion.h2
            variants={fadeUp}
            className="font-display text-3xl md:text-5xl lg:text-6xl font-light leading-[1.05] tracking-tighter text-ink text-balance"
          >
            Türk online alışverişin <span className="italic">üç gizli düşmanı</span>.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 lead max-w-2xl">
            Kampanya sezonu yaklaştıkça bu üç sorun büyüyor. Her biri tek başına çözülmeye
            çalışılıyor; bu yüzden kararlar parçalı kalıyor.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="grid md:grid-cols-3 gap-px bg-line"
        >
          {problems.map((p) => (
            <motion.div key={p.title} variants={fadeUp}>
              <Card className="h-full p-8 rounded-none border-0 bg-bg-primary">
                <div className="text-[11px] font-mono text-ink-faint mb-7">{p.n}</div>
                <h3 className="font-display text-2xl font-normal text-ink leading-tight mb-3">
                  {p.title}
                </h3>
                <p className="text-[15px] text-ink-soft leading-relaxed mb-8">{p.body}</p>
                <div className="hairline mb-5" />
                <div>
                  <div className="font-display text-3xl font-light text-ink">{p.stat}</div>
                  <div className="mt-2 text-[12px] text-ink-muted leading-snug">{p.statLabel}</div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
