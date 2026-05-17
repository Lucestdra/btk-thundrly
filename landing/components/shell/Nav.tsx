"use client";

import Link from "next/link";
import { Container } from "./Container";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/Button";

const links = [
  { href: "#sorun", label: "Sorun" },
  { href: "#cozum", label: "Çözüm" },
  { href: "#ajanlar", label: "Ajanlar" },
  { href: "#demo", label: "Demo" },
  { href: "#ornekler", label: "Örnekler" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-bg-primary/75 border-b border-line">
      <Container className="flex h-24 items-center justify-between">
        <Link href="/" className="group inline-flex items-center">
          <Logo size="lg" />
        </Link>

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

        <div className="flex items-center">
          <a href="#erken-erisim">
            <Button size="md" variant="primary">
              Erken Erişim
            </Button>
          </a>
        </div>
      </Container>
    </header>
  );
}
