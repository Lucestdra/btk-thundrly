"use client";

import { motion } from "framer-motion";
import {
  Globe,
  Puzzle,
  Server,
  MessageSquareText,
  ChartNoAxesCombined,
  WalletCards,
  MousePointerClick,
  Scale,
  Database,
  Cpu,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Container } from "@/components/shell/Container";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";
import { cn } from "@/lib/cn";

type LayerCard = {
  key: string;
  title: string;
  subtitle: string;
  desc: string;
  Icon: LucideIcon;
  bullets: string[];
};

const layers: LayerCard[] = [
  {
    key: "landing",
    title: "Landing",
    subtitle: "Next.js 15 · App Router",
    desc: "Tanıtım sayfası ve sentetik demo. Backend olmadan da çalışan canlı bir gösterim.",
    Icon: Globe,
    bullets: [
      "Sentetik fixture'lar (shared/demo)",
      "Framer Motion + Tailwind",
      "Statik SSR build (standalone)",
    ],
  },
  {
    key: "extension",
    title: "Chrome Extension",
    subtitle: "Manifest V3 · Shadow DOM",
    desc: "Sepete Ekle tıklamalarını yakalar, ürün payload'ı oluşturur, paneli render eder.",
    Icon: Puzzle,
    bullets: [
      "Capture-phase tıklama yakalama",
      "5 katmanlı productExtractor",
      "Shadow DOM izole panel (React)",
    ],
  },
  {
    key: "backend",
    title: "FastAPI Backend",
    subtitle: "Python · Pydantic · LangGraph",
    desc: "5 ajanı paralel çalıştıran orkestratör; karar ağırlıklı toplam + eskalasyon kuralı.",
    Icon: Server,
    bullets: [
      "4 paralel sinyal ajanı + karar ajanı",
      "TTL+LRU cache, retry + circuit breaker",
      "SQLAlchemy + Alembic (pgvector planlı)",
    ],
  },
];

const agents = [
  {
    key: "review",
    label: "Yorum",
    weight: "25%",
    desc: "Jaccard token tekrar + jenerik ifade + burst tespiti. Üretim: Gemini embeddings + DBSCAN.",
    Icon: MessageSquareText,
  },
  {
    key: "price",
    label: "Fiyat",
    weight: "30%",
    desc: "30/90 günlük fiyat geçmişi; indirim öncesi yapay yükseliş tespiti.",
    Icon: ChartNoAxesCombined,
  },
  {
    key: "budget",
    label: "Bütçe",
    weight: "25%",
    desc: "Aylık + kategori limitleri, kalan harcanabilir tutar; PostgreSQL kalıcı durum.",
    Icon: WalletCards,
  },
  {
    key: "impulse",
    label: "Dürtü",
    weight: "20%",
    desc: "Sayfa süresi, tıklama hızı, saat ve günlük alım kural seti.",
    Icon: MousePointerClick,
  },
];

const verdicts = [
  {
    label: "Yeşil",
    range: "0–39",
    tone: "border-verdict-green/45 bg-verdict-green/12 text-verdict-green",
    dot: "bg-verdict-green",
    desc: "Risk düşük. Devam edebilirsin.",
  },
  {
    label: "Sarı",
    range: "40–69",
    tone: "border-verdict-yellow/45 bg-verdict-yellow/12 text-verdict-yellow",
    dot: "bg-verdict-yellow",
    desc: "Şüpheli sinyal. 30 saniye düşün.",
  },
  {
    label: "Kırmızı",
    range: "70–100",
    tone: "border-verdict-red/45 bg-verdict-red/12 text-verdict-red",
    dot: "bg-verdict-red",
    desc: "Yüksek risk. İptal etmen öneriliyor.",
  },
];

const stack = [
  {
    title: "Frontend",
    Icon: Globe,
    items: ["Next.js 15", "React 19", "Tailwind CSS", "Framer Motion", "TypeScript"],
  },
  {
    title: "Eklenti",
    Icon: Puzzle,
    items: ["Manifest V3", "Vite + React", "Shadow DOM panel", "chrome.runtime mesajlaşma"],
  },
  {
    title: "Backend",
    Icon: Server,
    items: ["FastAPI", "Pydantic v2", "LangGraph orkestrasyon", "Google Gemini", "SQLAlchemy + Alembic"],
  },
  {
    title: "Veri & Altyapı",
    Icon: Database,
    items: ["PostgreSQL", "pgvector (planlı)", "TTL+LRU cache", "Docker Compose"],
  },
];

const flowSteps = [
  {
    step: "01",
    title: "Yakalama",
    desc: "Eklenti `contentScript` capture-phase listener'ı Trendyol/Hepsiburada/N11 sayfasında \"Sepete Ekle\" tıklamasını yakalar; `preventDefault()` + `stopImmediatePropagation()`.",
  },
  {
    step: "02",
    title: "Ürün Çıkarımı",
    desc: "5 katmanlı `productExtractor` JSON-LD → og:* meta → DOM seçicileri sırasıyla deneyerek normalize edilmiş bir ürün payload'ı üretir.",
  },
  {
    step: "03",
    title: "Panel + İstek",
    desc: "Shadow DOM içinde React panel mount edilir, `background.ts` service worker `POST /api/analyze-purchase` çağrısı yapar.",
  },
  {
    step: "04",
    title: "Orkestrasyon",
    desc: "FastAPI `orchestrator.analyze` LangGraph üzerinde 4 sinyal ajanını paralel başlatır; her ajan 0–100 risk puanı + gerekçeler döner.",
  },
  {
    step: "05",
    title: "Karar",
    desc: "`decision_agent` ağırlıklı toplamı hesaplar, eskalasyon kuralını uygular ve renk + özet + 3 gerekçe içeren AnalyzeResponse döner.",
  },
  {
    step: "06",
    title: "Sonuç & Eylem",
    desc: "Panel sonucu gösterir. \"Devam Et\" → `data-kg-bypass=1` ile orijinal click yeniden fire edilir; \"30 Saniye Düşün\" / \"Kapat\" → panel kapanır, satın alma iptal.",
  },
];

const principles = [
  {
    title: "Shadow DOM izolasyonu",
    Icon: ShieldCheck,
    desc: "Eklenti paneli host sayfanın CSS'inden tamamen izole; hiçbir e-ticaret stilinden etkilenmez, XSS sızıntısı host'a geçmez.",
  },
  {
    title: "Deterministik mock + canlı LLM",
    Icon: Cpu,
    desc: "Demo modu Gemini olmadan tekrarlanabilir çıktı verir. Üretim modunda Gemini retry + circuit breaker arkasında çalışır.",
  },
  {
    title: "Tek sözleşme, üç bileşen",
    Icon: Database,
    desc: "`AnalyzeRequest` / `AnalyzeResponse` shared/types ile TypeScript ve Pydantic'te aynalanır; landing/extension/backend aynı şemada buluşur.",
  },
];

export function ArchitectureSection() {
  return (
    <main className="pb-24">
      {/* Hero */}
      <section className="border-b border-line pt-16 pb-16 md:pt-24 md:pb-20">
        <Container>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={stagger}
            className="max-w-4xl"
          >
            <motion.div variants={fadeUp} className="kicker mb-4">
              Mimari
            </motion.div>
            <motion.h1
              variants={fadeUp}
              className="font-display text-4xl md:text-6xl lg:text-7xl font-light leading-[1.04] tracking-tightest text-balance text-ink"
            >
              Üç bileşen,{" "}
              <span className="italic font-normal">tek sözleşme</span>.
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-7 lead max-w-2xl text-pretty">
              Thundrly; landing, Chrome eklentisi ve FastAPI backend olmak üzere üç bağımsız
              bileşenden oluşur. Hepsi aynı{" "}
              <code className="px-1.5 py-0.5 rounded-sm bg-bg-tertiary/60 text-[14px]">
                AnalyzeRequest / AnalyzeResponse
              </code>{" "}
              sözleşmesi etrafında konuşur. Aşağıda her katmanın görevi,
              veri akışı ve karar mantığı net olarak anlatılıyor.
            </motion.p>
          </motion.div>
        </Container>
      </section>

      {/* Yüksek Seviye Diyagram */}
      <section className="border-b border-line pt-16 pb-16 md:pt-20 md:pb-20">
        <Container>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={stagger}
            className="max-w-3xl mb-10 md:mb-14"
          >
            <motion.div variants={fadeUp} className="kicker mb-3">
              01 · Yüksek seviye
            </motion.div>
            <motion.h2
              variants={fadeUp}
              className="font-display text-3xl md:text-4xl lg:text-5xl font-light leading-[1.08] tracking-tighter text-ink"
            >
              Üç katman, paylaşılan{" "}
              <span className="italic">tip sözleşmesi</span>.
            </motion.h2>
          </motion.div>

          <SystemDiagram />
        </Container>
      </section>

      {/* Ajan Sistemi */}
      <section className="border-b border-line pt-16 pb-16 md:pt-20 md:pb-20">
        <Container>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={stagger}
            className="max-w-3xl mb-10 md:mb-14"
          >
            <motion.div variants={fadeUp} className="kicker mb-3">
              02 · Orkestrasyon
            </motion.div>
            <motion.h2
              variants={fadeUp}
              className="font-display text-3xl md:text-4xl lg:text-5xl font-light leading-[1.08] tracking-tighter text-ink"
            >
              LangGraph: dört paralel sinyal,{" "}
              <span className="italic">tek karar</span>.
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-5 text-[15px] text-ink-soft leading-relaxed">
              Sinyal ajanları birbirinden bağımsız; karar ajanı fan-in node olarak çalışır,
              ağırlıklı toplamı ve eskalasyon kurallarını uygular.
            </motion.p>
          </motion.div>

          <AgentGraph />

          <div className="grid md:grid-cols-2 gap-4 md:gap-5 mt-10 md:mt-14">
            {agents.map((a) => {
              const Icon = a.Icon;
              return (
                <div
                  key={a.key}
                  className="card-elevated p-5 md:p-6 flex gap-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line-strong bg-bg-primary/70">
                    <Icon className="h-4.5 w-4.5 text-cerulean" strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <div className="font-display text-lg font-normal text-ink tracking-tight">
                        {a.label} Ajanı
                      </div>
                      <div className="text-[12px] text-ink-muted tabular-nums">
                        ağırlık {a.weight}
                      </div>
                    </div>
                    <div className="text-[13.5px] text-ink-soft leading-relaxed">
                      {a.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Container>
      </section>

      {/* Karar Mantığı */}
      <section className="border-b border-line pt-16 pb-16 md:pt-20 md:pb-20">
        <Container>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={stagger}
            className="max-w-3xl mb-10 md:mb-14"
          >
            <motion.div variants={fadeUp} className="kicker mb-3">
              03 · Karar
            </motion.div>
            <motion.h2
              variants={fadeUp}
              className="font-display text-3xl md:text-4xl lg:text-5xl font-light leading-[1.08] tracking-tighter text-ink"
            >
              Ağırlıklı toplam +{" "}
              <span className="italic">eskalasyon</span>.
            </motion.h2>
          </motion.div>

          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-8 lg:gap-12 items-start">
            <div className="card-elevated p-7 md:p-9">
              <div className="kicker mb-3">Ağırlıklı toplam</div>
              <div className="font-mono text-[14.5px] md:text-[15.5px] text-ink leading-relaxed bg-bg-tertiary/40 rounded-md px-4 py-4 border border-line">
                risk = 0.30·price + 0.25·review + 0.25·budget + 0.20·impulse
              </div>

              <div className="hairline my-6" />

              <div className="kicker mb-3">Eskalasyon kuralı</div>
              <p className="text-[14px] text-ink-soft leading-relaxed">
                Tek bir ajan çok güçlü sinyal veriyorsa ağırlıklı toplam düşük olsa bile
                karar yükseltilir — sinyal kaybolmasın diye.
              </p>
              <ul className="mt-3 space-y-2 text-[14px] text-ink-soft">
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-verdict-red shrink-0" />
                  <span>
                    <span className="font-mono">single_max ≥ 80</span> → risk en az{" "}
                    <span className="font-mono">70</span> (kırmızı zorunlu)
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-verdict-yellow shrink-0" />
                  <span>
                    <span className="font-mono">single_max ≥ 45</span> → risk en az{" "}
                    <span className="font-mono">42</span> (sarı zorunlu)
                  </span>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              {verdicts.map((v) => (
                <div
                  key={v.label}
                  className={cn(
                    "rounded-xl border px-5 py-4 flex items-start gap-4",
                    v.tone,
                  )}
                >
                  <div className="flex items-center gap-3 min-w-[120px]">
                    <span className={cn("h-2 w-2 rounded-full", v.dot)} />
                    <span className="font-display text-base font-medium tracking-tight">
                      {v.label}
                    </span>
                  </div>
                  <div className="flex-1 flex items-center justify-between gap-3">
                    <span className="text-[13.5px] opacity-90">{v.desc}</span>
                    <span className="font-mono text-[12.5px] opacity-80 tabular-nums">
                      {v.range}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* Veri Akışı */}
      <section className="border-b border-line pt-16 pb-16 md:pt-20 md:pb-20">
        <Container>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={stagger}
            className="max-w-3xl mb-10 md:mb-14"
          >
            <motion.div variants={fadeUp} className="kicker mb-3">
              04 · Veri akışı
            </motion.div>
            <motion.h2
              variants={fadeUp}
              className="font-display text-3xl md:text-4xl lg:text-5xl font-light leading-[1.08] tracking-tighter text-ink"
            >
              Sepete Ekle'den{" "}
              <span className="italic">karara</span>, 5 saniye.
            </motion.h2>
          </motion.div>

          <ol className="grid md:grid-cols-2 gap-4 md:gap-5">
            {flowSteps.map((s) => (
              <li key={s.step} className="card-elevated p-5 md:p-6">
                <div className="flex items-baseline gap-4 mb-2">
                  <span className="font-mono text-[12px] text-cerulean tabular-nums">
                    {s.step}
                  </span>
                  <h3 className="font-display text-lg font-normal text-ink tracking-tight">
                    {s.title}
                  </h3>
                </div>
                <p className="text-[13.5px] text-ink-soft leading-relaxed">
                  {s.desc}
                </p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Teknoloji Yığını */}
      <section className="border-b border-line pt-16 pb-16 md:pt-20 md:pb-20">
        <Container>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={stagger}
            className="max-w-3xl mb-10 md:mb-14"
          >
            <motion.div variants={fadeUp} className="kicker mb-3">
              05 · Teknoloji yığını
            </motion.div>
            <motion.h2
              variants={fadeUp}
              className="font-display text-3xl md:text-4xl lg:text-5xl font-light leading-[1.08] tracking-tighter text-ink"
            >
              Üç klasör,{" "}
              <span className="italic">paylaşılan tipler</span>.
            </motion.h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {stack.map((s) => {
              const Icon = s.Icon;
              return (
                <div key={s.title} className="card-elevated p-5 md:p-6">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line-strong bg-bg-primary/70">
                      <Icon className="h-4 w-4 text-cerulean" strokeWidth={1.7} />
                    </div>
                    <div className="font-display text-base font-medium text-ink tracking-tight">
                      {s.title}
                    </div>
                  </div>
                  <ul className="space-y-1.5">
                    {s.items.map((it) => (
                      <li
                        key={it}
                        className="text-[13px] text-ink-soft flex gap-2"
                      >
                        <span className="mt-1.5 h-1 w-1 rounded-full bg-ink-faint shrink-0" />
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Container>
      </section>

      {/* Tasarım Prensipleri */}
      <section className="pt-16 pb-4 md:pt-20">
        <Container>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={stagger}
            className="max-w-3xl mb-10 md:mb-14"
          >
            <motion.div variants={fadeUp} className="kicker mb-3">
              06 · Prensipler
            </motion.div>
            <motion.h2
              variants={fadeUp}
              className="font-display text-3xl md:text-4xl lg:text-5xl font-light leading-[1.08] tracking-tighter text-ink"
            >
              Neden{" "}
              <span className="italic">böyle kurduk</span>.
            </motion.h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-5">
            {principles.map((p) => {
              const Icon = p.Icon;
              return (
                <div key={p.title} className="card-elevated p-6 md:p-7">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line-strong bg-bg-primary/70 mb-4">
                    <Icon className="h-4.5 w-4.5 text-cerulean" strokeWidth={1.7} />
                  </div>
                  <div className="font-display text-lg font-normal text-ink tracking-tight mb-2">
                    {p.title}
                  </div>
                  <p className="text-[13.5px] text-ink-soft leading-relaxed">
                    {p.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </Container>
      </section>
    </main>
  );
}

function SystemDiagram() {
  return (
    <div className="relative">
      <div className="grid md:grid-cols-3 gap-4 md:gap-6">
        {layers.map((layer, i) => {
          const Icon = layer.Icon;
          return (
            <motion.div
              key={layer.key}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{ delay: i * 0.08, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="card-elevated p-6 md:p-7 relative"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-bg-primary/70">
                  <Icon className="h-5 w-5 text-cerulean" strokeWidth={1.7} />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-xl font-medium text-ink tracking-tight">
                    {layer.title}
                  </div>
                  <div className="text-[12px] text-ink-muted">{layer.subtitle}</div>
                </div>
              </div>
              <p className="text-[13.5px] text-ink-soft leading-relaxed mb-4">
                {layer.desc}
              </p>
              <ul className="space-y-1.5">
                {layer.bullets.map((b) => (
                  <li
                    key={b}
                    className="text-[12.5px] text-ink-soft flex gap-2"
                  >
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-cerulean/70 shrink-0" />
                    {b}
                  </li>
                ))}
              </ul>

              {/* Right-edge arrow (desktop only) */}
              {i < layers.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-3.5 -translate-y-1/2 z-10">
                  <ArrowRightSmall />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Shared contract bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="mt-6 md:mt-8 rounded-xl border border-cerulean/30 bg-cerulean/[0.06] px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5"
      >
        <div className="kicker text-cerulean">Paylaşılan sözleşme</div>
        <div className="font-mono text-[13px] text-ink-soft">
          shared/types/*.ts ↔ backend/app/models/schemas.py
        </div>
        <div className="sm:ml-auto text-[12px] text-ink-muted">
          AnalyzeRequest · AnalyzeResponse · DemoPayloads
        </div>
      </motion.div>
    </div>
  );
}

function AgentGraph() {
  return (
    <div className="card-elevated p-6 md:p-10">
      {/* Mobile: stacked */}
      <div className="lg:hidden space-y-3">
        <CenterPill label="POST /api/analyze-purchase" mono />
        <ArrowDown />
        <CenterPill label="orchestrator.analyze" />
        <ArrowDown />
        <div className="grid grid-cols-2 gap-2">
          {agents.map((a) => {
            const Icon = a.Icon;
            return (
              <div
                key={a.key}
                className="rounded-lg border border-line bg-bg-secondary/80 px-3 py-3 flex items-center gap-2"
              >
                <Icon className="h-4 w-4 text-cerulean shrink-0" strokeWidth={1.7} />
                <div className="min-w-0">
                  <div className="text-[13px] text-ink font-medium leading-tight">
                    {a.label}
                  </div>
                  <div className="text-[10.5px] text-ink-muted tabular-nums">
                    {a.weight}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <ArrowDown />
        <div className="rounded-xl border border-line-strong bg-bg-tertiary px-5 py-5 text-center">
          <Scale className="h-5 w-5 text-deep-space-blue mx-auto mb-2" strokeWidth={1.7} />
          <div className="font-display text-lg font-medium text-ink tracking-tight">
            Karar Ajanı
          </div>
          <div className="text-[11px] text-ink-soft mt-1">
            Ağırlıklı toplam + eskalasyon
          </div>
        </div>
        <ArrowDown />
        <CenterPill label="AnalyzeResponse" mono />
      </div>

      {/* Desktop: horizontal pipeline */}
      <div className="hidden lg:flex items-stretch gap-6">
        <div className="flex flex-col justify-center gap-2 w-[220px] shrink-0">
          <div className="rounded-md border border-cerulean/30 bg-cerulean/[0.08] px-3 py-2.5">
            <div className="kicker text-cerulean mb-1">Input</div>
            <div className="font-mono text-[12.5px] text-ink leading-tight">
              AnalyzeRequest
            </div>
            <div className="text-[11px] text-ink-muted mt-1">
              POST /api/analyze-purchase
            </div>
          </div>
        </div>

        <ConnectorOneToMany />

        <div className="flex flex-col gap-2.5 w-[240px] shrink-0 justify-center">
          {agents.map((a, i) => {
            const Icon = a.Icon;
            return (
              <motion.div
                key={a.key}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={viewportOnce}
                transition={{ delay: 0.1 + i * 0.07 }}
                className="rounded-xl border border-line bg-bg-secondary/80 px-3.5 py-3 flex items-center gap-3 shadow-line"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-bg-primary/70">
                  <Icon className="h-4 w-4 text-cerulean" strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-normal leading-tight text-ink">
                    {a.label} Ajanı
                  </div>
                  <div className="text-[11px] text-ink-muted tabular-nums mt-0.5">
                    ağırlık {a.weight}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        <ConnectorManyToOne />

        <div className="flex items-center w-[200px] shrink-0">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={viewportOnce}
            transition={{ delay: 0.5 }}
            className="w-full rounded-2xl border border-line-strong bg-bg-tertiary px-5 py-6 text-center shadow-soft"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-line-strong bg-bg-primary/70">
              <Scale className="h-5 w-5 text-deep-space-blue" strokeWidth={1.7} />
            </div>
            <div className="font-display text-lg font-medium leading-tight tracking-tight text-ink">
              Karar Ajanı
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-ink-soft">
              Ağırlıklı toplam + eskalasyon
            </div>
          </motion.div>
        </div>

        <ConnectorOneToOne />

        <div className="flex flex-col justify-center gap-2 w-[210px] shrink-0">
          <div className="rounded-md border border-line-strong bg-bg-primary/70 px-3 py-2.5">
            <div className="kicker mb-1">Output</div>
            <div className="font-mono text-[12.5px] text-ink leading-tight">
              AnalyzeResponse
            </div>
            <div className="text-[11px] text-ink-muted mt-1 leading-snug">
              decision · riskScore · summary · reasons · agents · action
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CenterPill({ label, mono = false }: { label: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-line-strong bg-bg-primary/70 px-4 py-2.5 text-center">
      <span
        className={cn(
          "text-[13px] text-ink",
          mono && "font-mono text-[12px]",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function ArrowDown() {
  return (
    <div className="flex justify-center">
      <svg width="14" height="20" viewBox="0 0 14 20" fill="none">
        <path
          d="M 7 2 L 7 14 M 2.5 11 L 7 16 L 11.5 11"
          stroke="#007ea7"
          strokeOpacity="0.5"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function ArrowRightSmall() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none">
      <path
        d="M 2 7 L 14 7 M 11 2.5 L 16 7 L 11 11.5"
        stroke="#007ea7"
        strokeOpacity="0.55"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConnectorOneToMany() {
  const ys = [12, 36, 64, 88];
  return (
    <div className="w-[64px] shrink-0 self-stretch relative">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
      >
        {ys.map((y, i) => (
          <motion.path
            key={y}
            d={`M 0 50 C 45 50, 55 ${y}, 100 ${y}`}
            stroke="#007ea7"
            strokeOpacity="0.32"
            strokeWidth="1.4"
            strokeDasharray="4 6"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={viewportOnce}
            transition={{ duration: 0.9, delay: 0.18 + i * 0.06 }}
          />
        ))}
      </svg>
    </div>
  );
}

function ConnectorManyToOne() {
  const ys = [12, 36, 64, 88];
  return (
    <div className="w-[64px] shrink-0 self-stretch relative">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
      >
        {ys.map((y, i) => (
          <motion.path
            key={y}
            d={`M 0 ${y} C 45 ${y}, 55 50, 100 50`}
            stroke="#007ea7"
            strokeOpacity="0.32"
            strokeWidth="1.4"
            strokeDasharray="4 6"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={viewportOnce}
            transition={{ duration: 0.9, delay: 0.3 + i * 0.06 }}
          />
        ))}
        <motion.circle
          cx="100"
          cy="50"
          r="3"
          className="fill-cerulean"
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={viewportOnce}
          transition={{ delay: 0.7, duration: 0.3 }}
        />
      </svg>
    </div>
  );
}

function ConnectorOneToOne() {
  return (
    <div className="w-[52px] shrink-0 self-stretch relative">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
      >
        <motion.path
          d="M 0 50 L 100 50"
          stroke="#007ea7"
          strokeOpacity="0.42"
          strokeWidth="1.4"
          strokeDasharray="4 6"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0, opacity: 0 }}
          whileInView={{ pathLength: 1, opacity: 1 }}
          viewport={viewportOnce}
          transition={{ duration: 0.7, delay: 0.65 }}
        />
        <motion.polyline
          points="92,44 100,50 92,56"
          stroke="#007ea7"
          strokeOpacity="0.55"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={viewportOnce}
          transition={{ delay: 1.05 }}
        />
      </svg>
    </div>
  );
}
