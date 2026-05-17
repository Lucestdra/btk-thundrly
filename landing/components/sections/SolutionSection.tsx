"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/shell/Container";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

const steps = [
  {
    n: "01",
    title: "Sepete Ekle'ye bas",
    body:
      "Eklenti Trendyol, Hepsiburada veya N11'de buton tıklamasını yakalar ve panel açar.",
  },
  {
    n: "02",
    title: "5 ajan paralel analiz eder",
    body:
      "Yorum, fiyat, bütçe, dürtü ve karar ajanları ürünü, geçmişi ve seni dikkate alarak ~5 saniyede çalışır.",
  },
  {
    n: "03",
    title: "Tek karar verir",
    body:
      "Sade bir karar, üç güçlü gerekçe ve 'Devam et' ya da '30 saniye düşün' aksiyonu — daha fazlası değil.",
  },
];

export function SolutionSection() {
  return (
    <section id="cozum" className="fullscreen border-t border-line">
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
            Üç adımda <span className="italic">bilinçli karar</span>.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 lead max-w-2xl">
            Karmaşıklığı arkada bırakır, sana sadece yapman gerekeni söyler.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="grid md:grid-cols-3 gap-8 md:gap-10"
        >
          {steps.map((s) => (
            <motion.div key={s.n} variants={fadeUp}>
              <div className="pt-6 border-t border-line-strong">
                <div className="text-[11px] font-mono text-ink-muted mb-6">{s.n}</div>
                <h3 className="font-display text-2xl font-normal text-ink leading-tight mb-3">
                  {s.title}
                </h3>
                <p className="text-[15px] text-ink-soft leading-relaxed">{s.body}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
