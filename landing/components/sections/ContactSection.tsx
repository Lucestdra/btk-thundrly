"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Globe,
  ShieldCheck,
} from "lucide-react";
import { Container } from "@/components/shell/Container";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Status =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "success" }
  | { phase: "error"; message: string };

type FieldErrors = Partial<Record<"name" | "email" | "subject" | "message", string>>;

const CONTACT_EMAIL = "agdemirhalim4@gmail.com";

const facts = [
  {
    Icon: Clock,
    title: "Hızlı yanıt",
    desc: "Çoğu mesaj 24 saat içinde yanıtlanır.",
  },
  {
    Icon: Globe,
    title: "Türkçe destek",
    desc: "Ürün ekibi tamamen Türkçe iletişim kurar.",
  },
  {
    Icon: ShieldCheck,
    title: "Spam korumalı",
    desc: "Honeypot + rate limit; mesajın güvenli ulaşır.",
  },
];

function validate(values: {
  name: string;
  email: string;
  subject: string;
  message: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  if (values.name.trim().length < 2) {
    errors.name = "Adın en az 2 karakter olmalı.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Geçerli bir e-posta adresi gir.";
  }
  if (values.subject.trim().length < 3) {
    errors.subject = "Konu en az 3 karakter olmalı.";
  }
  if (values.message.trim().length < 20) {
    errors.message = "Mesaj en az 20 karakter olmalı.";
  } else if (values.message.length > 4000) {
    errors.message = "Mesaj 4000 karakteri aşamaz.";
  }
  return errors;
}

export function ContactSection() {
  const [values, setValues] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const liveRegionRef = useRef<HTMLDivElement>(null);

  const charCount = values.message.length;
  const isSubmitting = status.phase === "submitting";
  const isSuccess = status.phase === "success";

  useEffect(() => {
    if (status.phase !== "success") return;
    const t = window.setTimeout(() => setStatus({ phase: "idle" }), 6000);
    return () => window.clearTimeout(t);
  }, [status.phase]);

  const onChange =
    (k: keyof typeof values) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setValues((prev) => ({ ...prev, [k]: e.target.value }));
      if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
    };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    const fieldErrors = validate(values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setStatus({ phase: "error", message: "Lütfen formdaki hataları düzelt." });
      return;
    }

    setStatus({ phase: "submitting" });
    setErrors({});

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, website }),
      });

      if (res.ok) {
        setStatus({ phase: "success" });
        setValues({ name: "", email: "", subject: "", message: "" });
        return;
      }

      const data = (await res.json().catch(() => null)) as
        | { error?: string; field?: string }
        | null;

      if (data?.field && typeof data.field === "string") {
        setErrors({ [data.field]: data.error || "Geçersiz değer." });
      }
      setStatus({
        phase: "error",
        message:
          data?.error || "Mesaj gönderilemedi. Lütfen tekrar dene.",
      });
    } catch {
      setStatus({
        phase: "error",
        message: "Ağ hatası. Bağlantını kontrol edip tekrar dene.",
      });
    }
  };

  return (
    <section
      id="iletisim"
      className="relative border-t border-line py-20 md:py-28"
    >
      <Container>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="max-w-3xl mb-12 md:mb-16"
        >
          <motion.div variants={fadeUp} className="kicker mb-3">
            İletişim
          </motion.div>
          <motion.h2
            variants={fadeUp}
            className="font-display text-3xl md:text-5xl lg:text-6xl font-light leading-[1.05] tracking-tighter text-ink text-balance"
          >
            Bir sorun, bir geri bildirim,{" "}
            <span className="italic">bir fikir</span>.
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mt-5 lead max-w-2xl text-pretty"
          >
            Thundrly hakkında her şeyi yazabilirsin — bug raporu, özellik isteği,
            iş birliği önerisi. Mesajın doğrudan ürün ekibine ulaşır.
          </motion.p>
        </motion.div>

        <div className="grid lg:grid-cols-[1fr_1.35fr] gap-8 lg:gap-12 items-start">
          {/* Left: meta info */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewportOnce}
            transition={{ duration: 0.55 }}
            className="space-y-5"
          >
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="card-elevated p-5 md:p-6 block group transition-colors hover:border-cerulean/40"
            >
              <div className="flex items-center gap-3 mb-3">
                <motion.div
                  animate={{
                    boxShadow: [
                      "0 0 0 0 rgba(0,126,167,0)",
                      "0 0 0 6px rgba(0,126,167,0.14)",
                      "0 0 0 0 rgba(0,126,167,0)",
                    ],
                  }}
                  transition={{ duration: 2.6, repeat: Infinity }}
                  className="flex h-10 w-10 items-center justify-center rounded-md border border-line-strong bg-bg-primary/70"
                >
                  <Mail className="h-4 w-4 text-cerulean" strokeWidth={1.7} />
                </motion.div>
                <div className="kicker">Doğrudan e-posta</div>
              </div>
              <div className="font-display text-lg font-normal text-ink tracking-tight break-all group-hover:text-cerulean transition-colors">
                {CONTACT_EMAIL}
              </div>
              <div className="text-[12.5px] text-ink-muted mt-1.5">
                Formu doldurmak yerine direkt e-posta da gönderebilirsin.
              </div>
            </a>

            <div className="space-y-3">
              {facts.map((f, i) => {
                const Icon = f.Icon;
                return (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={viewportOnce}
                    transition={{ delay: 0.1 + i * 0.06 }}
                    className="card p-4 flex items-start gap-3"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-bg-primary/70">
                      <Icon className="h-4 w-4 text-cerulean" strokeWidth={1.7} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-display text-[14.5px] text-ink font-normal leading-tight">
                        {f.title}
                      </div>
                      <div className="text-[12.5px] text-ink-muted leading-snug mt-0.5">
                        {f.desc}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          {/* Right: form */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewportOnce}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="card-elevated p-6 md:p-9 relative overflow-hidden"
          >
            <AnimatePresence>
              {isSuccess && (
                <motion.div
                  key="success-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 z-10 bg-bg-secondary/95 backdrop-blur-sm flex flex-col items-center justify-center text-center p-8"
                  aria-live="polite"
                >
                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      type: "spring",
                      stiffness: 220,
                      damping: 16,
                    }}
                    className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-verdict-green/15 border border-verdict-green/40"
                  >
                    <CheckCircle2
                      className="h-7 w-7 text-verdict-green"
                      strokeWidth={1.8}
                    />
                  </motion.div>
                  <h3 className="font-display text-2xl font-normal text-ink tracking-tight mb-2">
                    Mesajın gönderildi.
                  </h3>
                  <p className="text-[14px] text-ink-soft max-w-xs leading-relaxed">
                    Genellikle 24 saat içinde dönüş yapıyoruz. Bu arada kahveni
                    yudumlayabilirsin.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStatus({ phase: "idle" })}
                    className="mt-6 text-[12.5px] text-ink-muted hover:text-ink transition-colors underline-offset-4 hover:underline"
                  >
                    Başka bir mesaj gönder
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={onSubmit} noValidate>
              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <Field
                  label="Ad Soyad"
                  id="contact-name"
                  error={errors.name}
                  required
                >
                  <Input
                    id="contact-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Adın"
                    value={values.name}
                    onChange={onChange("name")}
                    disabled={isSubmitting}
                    maxLength={120}
                    aria-invalid={!!errors.name}
                  />
                </Field>

                <Field
                  label="E-posta"
                  id="contact-email"
                  error={errors.email}
                  required
                >
                  <Input
                    id="contact-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="seninadres@ornek.com"
                    value={values.email}
                    onChange={onChange("email")}
                    disabled={isSubmitting}
                    maxLength={200}
                    aria-invalid={!!errors.email}
                  />
                </Field>
              </div>

              <div className="mb-4">
                <Field
                  label="Konu"
                  id="contact-subject"
                  error={errors.subject}
                  required
                >
                  <Input
                    id="contact-subject"
                    name="subject"
                    type="text"
                    placeholder="Neyle ilgili yazıyorsun?"
                    value={values.subject}
                    onChange={onChange("subject")}
                    disabled={isSubmitting}
                    maxLength={200}
                    aria-invalid={!!errors.subject}
                  />
                </Field>
              </div>

              <div className="mb-2">
                <Field
                  label="Mesaj"
                  id="contact-message"
                  error={errors.message}
                  required
                  trailing={
                    <span
                      className={cn(
                        "text-[11px] tabular-nums",
                        charCount > 4000
                          ? "text-verdict-red"
                          : charCount >= 3800
                            ? "text-verdict-yellow"
                            : "text-ink-muted",
                      )}
                    >
                      {charCount} / 4000
                    </span>
                  }
                >
                  <textarea
                    id="contact-message"
                    name="message"
                    rows={6}
                    placeholder="Mesajını yaz…"
                    value={values.message}
                    onChange={onChange("message")}
                    disabled={isSubmitting}
                    maxLength={4000}
                    aria-invalid={!!errors.message}
                    className={cn(
                      "w-full rounded-md border border-line bg-bg-secondary/40 px-4 py-3 text-sm text-ink placeholder:text-ink-muted",
                      "outline-none transition-colors duration-150 resize-y min-h-[150px]",
                      "focus:border-line-strong focus:bg-bg-secondary",
                    )}
                  />
                </Field>
              </div>

              {/* Honeypot field — hidden from real users, bots fill it. */}
              <div
                aria-hidden
                className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
              >
                <label htmlFor="contact-website">Website (boş bırak)</label>
                <input
                  id="contact-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              <div
                ref={liveRegionRef}
                aria-live="polite"
                className="min-h-[24px] mt-2"
              >
                <AnimatePresence mode="wait">
                  {status.phase === "error" && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="inline-flex items-center gap-2 text-[13px] text-verdict-red"
                    >
                      <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
                      <span>{status.message}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <p className="text-[11.5px] text-ink-muted leading-relaxed">
                  Form üzerinden gönderdiğin bilgiler yalnızca yanıt için kullanılır
                  ve üçüncü taraflarla paylaşılmaz.
                </p>
                <Button
                  type="submit"
                  size="lg"
                  variant="primary"
                  disabled={isSubmitting}
                  className="sm:min-w-[180px]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Gönderiliyor…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Mesajı Gönder
                    </>
                  )}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}

function Field({
  label,
  id,
  required,
  error,
  trailing,
  children,
}: {
  label: string;
  id: string;
  required?: boolean;
  error?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <label
          htmlFor={id}
          className="text-[12px] text-ink-soft font-medium tracking-wide"
        >
          {label}
          {required && (
            <span aria-hidden className="text-cerulean/70 ml-0.5">
              *
            </span>
          )}
        </label>
        {trailing && <div>{trailing}</div>}
      </div>
      {children}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            className="mt-1.5 text-[11.5px] text-verdict-red flex items-center gap-1.5"
          >
            <AlertCircle className="h-3 w-3" strokeWidth={2} />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
