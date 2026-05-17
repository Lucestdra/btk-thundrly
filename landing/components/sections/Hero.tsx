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
          className="grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-20 items-center"
        >
          <div className="order-2 lg:order-1">
            <motion.h1
              variants={fadeUp}
              className="font-display text-[44px] md:text-[64px] lg:text-[76px] font-light leading-[1.02] tracking-tightest text-balance text-ink"
            >
              Satın almadan önce
              <br />
              <span className="italic font-normal">5 saniyelik</span> akıllı kontrol.
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="mt-7 lead max-w-xl text-pretty"
            >
              Yorumları, fiyat geçmişini, bütçeni ve dürtüsel alışveriş riskini analiz ederek
              sana yeşil, sarı veya kırmızı bir karar verir.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-9 flex flex-col sm:flex-row gap-3">
              <a href="#demo">
                <Button size="lg" variant="primary" className="w-full sm:w-auto">
                  Demo'yu Gör
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
              <a href="#cozum">
                <Button size="lg" variant="quiet" className="w-full sm:w-auto">
                  Nasıl Çalışır?
                </Button>
              </a>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 text-[12px] text-ink-muted"
            >
              <span>Trendyol, Hepsiburada, N11 uyumlu</span>
              <span className="text-ink-faint">·</span>
              <span>LangGraph multi-agent mimari</span>
              <span className="text-ink-faint">·</span>
              <span>Türkçe açıklama</span>
            </motion.div>
          </div>

          <motion.div
            variants={fadeUp}
            className="order-1 lg:order-2 relative flex justify-center lg:justify-end"
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
