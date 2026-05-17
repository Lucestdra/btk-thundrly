"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Container } from "./Container";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const links = [
  { href: "#sorun", label: "Sorun" },
  { href: "#cozum", label: "Çözüm" },
  { href: "#ajanlar", label: "Ajanlar" },
  { href: "#demo", label: "Demo" },
  { href: "#ornekler", label: "Örnekler" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  // Close drawer on hash change so tapping a link doesn't leave it hanging.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [open]);

  // Prevent body scroll when drawer is open.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-bg-primary/75 border-b border-line">
      <Container className="flex h-16 md:h-24 items-center justify-between">
        <Link href="/" className="group inline-flex items-center" aria-label="Thundrly anasayfa">
          <span className="md:hidden"><Logo size="md" /></span>
          <span className="hidden md:inline"><Logo size="lg" /></span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-9">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[14px] text-ink-soft hover:text-ink transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop CTA + mobile menu trigger */}
        <div className="flex items-center gap-2">
          <a href="#erken-erisim" className="hidden sm:inline-flex">
            <Button size="md" variant="primary">
              Erken Erişim
            </Button>
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav-drawer"
            aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/60"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </Container>

      {/* Mobile drawer */}
      <div
        id="mobile-nav-drawer"
        className={cn(
          "md:hidden border-t border-line bg-bg-primary/98 backdrop-blur-md overflow-hidden transition-[max-height,opacity] duration-200 ease-out",
          open ? "max-h-[480px] opacity-100" : "max-h-0 opacity-0 pointer-events-none",
        )}
      >
        <Container className="py-4">
          <nav className="flex flex-col">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="py-3 text-[15px] text-ink-soft hover:text-ink border-b border-line/60 last:border-b-0"
              >
                {l.label}
              </a>
            ))}
            <a
              href="#erken-erisim"
              onClick={() => setOpen(false)}
              className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-[15px] font-medium text-alabaster-grey hover:bg-deep-space-blue transition-colors"
            >
              Erken Erişim
            </a>
          </nav>
        </Container>
      </div>
    </header>
  );
}
