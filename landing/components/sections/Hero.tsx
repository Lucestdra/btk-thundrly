"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/shell/Container";
import { Button } from "@/components/ui/Button";
import { ExtensionPanelMock } from "@/components/demo/ExtensionPanelMock";
import { ProductPageMock } from "@/components/demo/ProductPageMock";
import { redHoodieResponse } from "@shared/demo/demoPayloads";
import { fadeUp, stagger } from "@/lib/motion";

export function Hero() {
  return (
    <section className="relative overflow-hidden fullscreen-hero">
      <Container className="relative">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="grid lg:grid-cols-[1.05fr_1fr] gap-10 sm:gap-14 lg:gap-20 items-center"
        >
          <div>
            <motion.h1
              variants={fadeUp}
              className="font-display text-[34px] sm:text-[52px] md:text-[64px] lg:text-[76px] font-light leading-[1.05] sm:leading-[1.02] tracking-tightest text-balance text-ink"
            >
              Satın almadan önce
              <br />
              <span className="italic font-normal">5 saniyelik</span> akıllı kontrol.
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mt-5 sm:mt-7 lead max-w-xl text-pretty"
            >
              Yorumları, fiyat geçmişini, bütçeni ve dürtüsel alışveriş riskini analiz ederek
              sana yeşil, sarı veya kırmızı bir karar verir.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-7 sm:mt-9 flex flex-col sm:flex-row gap-3">
              <a href="#demo" className="w-full sm:w-auto">
                <Button size="lg" variant="primary" className="w-full sm:w-auto">
                  Demo'yu Gör
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
              <a href="#cozum" className="w-full sm:w-auto">
                <Button size="lg" variant="quiet" className="w-full sm:w-auto">
                  Nasıl Çalışır?
                </Button>
              </a>
            </motion.div>
          </div>

          {/* Decorative product + panel mock — md+ only; on tablet (md-lg)
              it appears BELOW the headline thanks to natural DOM order. */}
          <motion.div
            variants={fadeUp}
            className="hidden md:flex relative justify-center lg:justify-end"
          >
            <div className="relative w-full max-w-[540px]">
              <ProductPageMock className="opacity-70 scale-[0.96] origin-top-left" />
              <div className="absolute -bottom-8 -right-2 sm:-bottom-6 sm:right-2 lg:-right-6 z-10">
                <ExtensionPanelMock result={redHoodieResponse} floating />
              </div>
            </div>
          </motion.div>
        </motion.div>
      </Container>
    </section>
  );
}
