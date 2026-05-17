"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/shell/Container";
import { AgentFlowDiagram } from "@/components/demo/AgentFlowDiagram";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

const agentMeta = [
  { name: "Yorum Ajanı", desc: "Tekrar eden örüntüler, kümelenmiş yorumlar, jenerik dil." },
  { name: "Fiyat Ajanı", desc: "30 / 90 günlük geçmiş, indirim öncesi yükseliş tespiti." },
  { name: "Bütçe Ajanı", desc: "Aylık + kategori limitleri, kalan harcanabilir tutar." },
  { name: "Dürtü Ajanı", desc: "Sayfada geçen süre, tıklama hızı, günün saati, günlük alım." },
  { name: "Karar Ajanı", desc: "Ağırlıklı toplam → tek karar: yeşil, sarı veya kırmızı." },
];

export function AgentSystemSection() {
  return (
    <section id="ajanlar" className="fullscreen border-t border-line">
      <Container>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="max-w-3xl mb-14 md:mb-20"
        >
          <motion.h2
            variants={fadeUp}
            className="font-display text-3xl md:text-5xl lg:text-6xl font-light leading-[1.05] tracking-tighter text-ink text-balance"
          >
            Beş ajan, <span className="italic">tek karar</span>.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 lead max-w-2xl">
            Her ajan tek bir şeyi çok iyi yapar; karar orkestratörü sinyalleri ağırlıklı olarak
            birleştirir ve sana sadeleştirilmiş bir sonuç verir.
          </motion.p>
        </motion.div>

        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-16 items-start">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={viewportOnce}
          >
            <AgentFlowDiagram />
          </motion.div>

          <motion.ul
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={stagger}
            className="divide-y divide-line"
          >
            {agentMeta.map((a) => (
              <motion.li
                key={a.name}
                variants={fadeUp}
                className="py-5"
              >
                <div className="font-display text-lg font-normal text-ink mb-1">{a.name}</div>
                <div className="text-[14px] text-ink-soft leading-relaxed">{a.desc}</div>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </Container>
    </section>
  );
}
