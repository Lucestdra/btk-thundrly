"use client";

import { useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { Container } from "@/components/shell/Container";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { fadeUp, stagger, viewportOnce } from "@/lib/motion";

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function FinalCTASection() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      setError("Geçerli bir e-posta adresi gir.");
      return;
    }
    setError(null);
    setSubmitted(true);
  };

  return (
    <section id="erken-erisim" className="fullscreen border-t border-line">
      <Container className="relative">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger}
          className="mx-auto max-w-3xl text-center"
        >
          <motion.h2
            variants={fadeUp}
            className="font-display text-4xl md:text-6xl lg:text-7xl font-light leading-[1.02] tracking-tightest text-ink text-balance"
          >
            Pişmanlık alışverişlerini azalt.
            <br />
            <span className="italic">Gerçek fırsatları</span> kaçırma.
          </motion.h2>

          <motion.p
            variants={fadeUp}
            className="mt-8 lead max-w-xl mx-auto"
          >
            Erken erişim listesine katıl; eklenti yayına girdiğinde Türk e-ticaret kampanyalarına
            hazır olarak başla.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-10 max-w-md mx-auto">
            <AnimatePresence mode="wait">
              {!submitted ? (
                <motion.form
                  key="form"
                  onSubmit={onSubmit}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col sm:flex-row gap-2"
                  noValidate
                >
                  <Input
                    type="email"
                    placeholder="e-posta adresin"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError(null);
                    }}
                    aria-invalid={!!error}
                    aria-describedby="email-error"
                    required
                    className="flex-1"
                  />
                  <Button type="submit" size="md" variant="primary">
                    Katıl
                  </Button>
                </motion.form>
              ) : (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-3 rounded-md border border-line-strong bg-bg-secondary/60 px-4 py-3 text-left"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong">
                    <Check className="h-3.5 w-3.5 text-ink" strokeWidth={2.5} />
                  </span>
                  <div className="text-[14px] text-ink-soft">
                    Teşekkürler — <span className="text-ink">{email}</span> listeye eklendi.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div
                id="email-error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 text-[12px] text-ink-muted text-left"
              >
                {error}
              </motion.div>
            )}

            <p className="mt-5 text-[12px] text-ink-faint">
              Yalnızca lansman haberleri. Spam yok, üçüncü taraflarla paylaşılmaz.
            </p>
          </motion.div>
        </motion.div>
      </Container>
    </section>
  );
}
