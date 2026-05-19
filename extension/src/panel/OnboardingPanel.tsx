import { useCallback, useEffect, useState } from "react";
import { LogoMark } from "@/components/LogoMark";
import "./Panel.css";

interface OnboardingPanelProps {
  onFinish: () => void;
  onDismiss: () => void;
}

type Step = {
  kicker: string;
  title: string;
  body: string;
  /** Step-specific visual that lives in the hero slot. */
  render: () => JSX.Element;
};

function StepWelcome() {
  return (
    <div className="kg-ob-hero">
      <div className="kg-ob-logo-burst">
        <LogoMark size={64} />
      </div>
    </div>
  );
}

function StepVerdicts() {
  const items: { tone: "green" | "yellow" | "red"; label: string; body: string }[] = [
    { tone: "green", label: "Yeşil", body: "Güvenli alım. İndirim gerçek, yorumlar temiz." },
    { tone: "yellow", label: "Sarı", body: "Birkaç dikkat sinyali. Tekrar göz at." },
    { tone: "red", label: "Kırmızı", body: "Birden fazla güçlü uyarı. 30 saniye düşün." },
  ];
  return (
    <div className="kg-ob-hero kg-ob-verdicts">
      {items.map((it, i) => (
        <div
          key={it.tone}
          className={`kg-ob-vcard kg-ob-vcard-${it.tone}`}
          style={{ animationDelay: `${80 + i * 90}ms` }}
        >
          <span className={`kg-ob-vdot kg-ob-vdot-${it.tone}`} />
          <strong>{it.label}</strong>
          <span className="kg-ob-vbody">{it.body}</span>
        </div>
      ))}
    </div>
  );
}

function StepAgents() {
  const agents = [
    { name: "Yorum", body: "Tekrar eden, sahte yorum kalıplarını tarar." },
    { name: "Fiyat", body: "30-gün yasası + DB + Akakçe karşılaştırır." },
    { name: "Bütçe", body: "Aylık ve kategori bütçeni dikkate alır." },
    { name: "Dürtü", body: "Sayfada geçen süre, saat, sıklığı ölçer." },
    { name: "Karar", body: "Dört sinyali birleştirip nihai rengi verir." },
  ];
  return (
    <div className="kg-ob-hero kg-ob-agents">
      {agents.map((a, i) => (
        <div
          key={a.name}
          className="kg-ob-agent"
          style={{ animationDelay: `${60 + i * 70}ms` }}
        >
          <span className="kg-ob-agent-num">{i + 1}</span>
          <div>
            <strong>{a.name}</strong>
            <span>{a.body}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StepBudget() {
  return (
    <div className="kg-ob-hero kg-ob-budget">
      <div className="kg-ob-budget-card">
        <div className="kg-ob-budget-row">
          <span className="kg-ob-budget-label">Aylık genel bütçen</span>
          <span className="kg-ob-budget-val">₺ ——</span>
        </div>
        <div className="kg-ob-budget-bar">
          <span className="kg-ob-budget-fill" />
        </div>
        <div className="kg-ob-budget-meta">
          Tarayıcı çubuğundaki Thundrly simgesinden istediğin an düzenleyebilirsin.
        </div>
      </div>
    </div>
  );
}

function StepReady() {
  return (
    <div className="kg-ob-hero kg-ob-ready">
      <div className="kg-ob-ready-burst">
        <LogoMark size={56} accent="#6d8c4a" />
      </div>
      <ul className="kg-ob-ready-list">
        <li>Sepete Ekle&apos;ye bas → 5 saniye analiz</li>
        <li>Yeşil/Sarı/Kırmızı karar gör → istersen devam et</li>
        <li>Karar her zaman senin — biz yalnızca sinyalleri gösteririz</li>
      </ul>
    </div>
  );
}

const STEPS: Step[] = [
  {
    kicker: "Hoş geldin",
    title: "Satın almadan önce 5 saniye düşünelim.",
    body: "Thundrly, Türk e-ticaret sitelerinde Sepete Ekle’ye bastığında devreye girer ve ürünü hızlıca analiz eder.",
    render: StepWelcome,
  },
  {
    kicker: "1/4 · Karar renkleri",
    title: "Üç renk — tek bakışta anla.",
    body: "Her ürün için Thundrly’nin verdiği karar üç renkten birinde olur.",
    render: StepVerdicts,
  },
  {
    kicker: "2/4 · Ajanlar",
    title: "5 ajan, paralel çalışır.",
    body: "Her ajan ürünün farklı bir yönüne bakar. Sinyallerini birleştirip nihai kararı oluştururuz.",
    render: StepAgents,
  },
  {
    kicker: "3/4 · Bütçe",
    title: "Bütçeni biz takip ederiz.",
    body: "Aylık genel bütçeni belirle; her ürün için ne kadar zorladığını gösterelim.",
    render: StepBudget,
  },
  {
    kicker: "4/4 · Hazır",
    title: "Hepsi bu kadar.",
    body: "Şimdi alışverişe devam et. Sepete Ekle’ye bastığında seninle olacağız.",
    render: StepReady,
  },
];

export function OnboardingPanel({ onFinish, onDismiss }: OnboardingPanelProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const step = STEPS[stepIdx];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  // Re-trigger the enter animation whenever we change steps.
  useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [stepIdx]);

  const next = useCallback(() => {
    if (isLast) {
      onFinish();
      return;
    }
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  }, [isLast, onFinish]);

  const back = useCallback(() => {
    setStepIdx((i) => Math.max(i - 1, 0));
  }, []);

  return (
    <div className="kg-panel kg-ob" role="dialog" aria-label="Thundrly tanıtım">
      <div className="kg-header">
        <div className="kg-brand">
          <span className="kg-logo">
            <LogoMark size={22} accent="#003249" />
          </span>
          <div className="kg-brand-text">
            <small>Thundrly</small>
            <strong>İlk kullanım rehberi</strong>
          </div>
        </div>
        <button
          className="kg-x"
          aria-label="Tanıtımı atla"
          onClick={() => {
            onFinish();
            onDismiss();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="kg-ob-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={stepIdx + 1}>
        {STEPS.map((_, i) => (
          <span
            key={i}
            className={`kg-ob-progress-pip ${i <= stepIdx ? "active" : ""}`}
          />
        ))}
      </div>

      <div className="kg-ob-stage" key={animKey}>
        <div className="kg-ob-kicker">{step.kicker}</div>
        <h2 className="kg-ob-title">{step.title}</h2>
        <p className="kg-ob-body">{step.body}</p>
        {step.render()}
      </div>

      <div className="kg-actions kg-ob-actions">
        <button className="kg-btn kg-btn-primary" onClick={next}>
          {isLast ? "Hazırım, başlayalım" : "Devam"}
        </button>
        {!isFirst && (
          <button className="kg-btn" onClick={back}>
            Geri
          </button>
        )}
      </div>
    </div>
  );
}
