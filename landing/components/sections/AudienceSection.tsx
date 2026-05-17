"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/shell/Container";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

const audience = [
  { label: "22–45", desc: "Türk online tüketicileri" },
  { label: "3+ / ay", desc: "online alışveriş sıklığı" },
  { label: "Chrome", desc: "tarayıcı kullanıcıları" },
  { label: "Bilinçli", desc: "harcamayı yönetmek isteyenler" },
  { label: "Kampanya yorgunu", desc: "indirim bombardımanı altında" },
];

export function AudienceSection() {
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
            Türk e-ticaret alışkanlıklarına göre <span className="italic">tasarlandı</span>.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 lead max-w-2xl">
            Kampanya sezonlarında karar yorgunluğu yaşayan, harcamasını bilinçli yönetmek isteyen
            kullanıcılar için bir araç.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="grid grid-cols-2 md:grid-cols-5 gap-px bg-line"
        >
          {audience.map((a) => (
            <motion.div
              key={a.label}
              variants={fadeUp}
              className="bg-bg-primary p-8"
            >
              <div className="font-display text-2xl md:text-3xl font-light text-ink mb-2 leading-none tracking-tight">
                {a.label}
              </div>
              <div className="text-[13px] text-ink-soft leading-snug">{a.desc}</div>
            </motion.div>
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
