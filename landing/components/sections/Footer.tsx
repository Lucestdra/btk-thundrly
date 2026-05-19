import { Container } from "@/components/shell/Container";

const cols = [
  {
    title: "Ürün",
    links: [
      { label: "Demo", href: "#demo" },
      { label: "Ajanlar", href: "#ajanlar" },
      { label: "Örnekler", href: "#ornekler" },
      { label: "Erken Erişim", href: "#erken-erisim" },
    ],
  },
  {
    title: "Kaynaklar",
    links: [
      { label: "Mimari", href: "/mimari" },
    ],
  },
  {
    title: "Geliştirici",
    links: [
      { label: "GitHub", href: "https://github.com/Lucestdra/btk-thundrly.git" },
      { label: "İletişim", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-line pt-20 pb-12">
      <Container>
        <div className="grid md:grid-cols-12 gap-12 mb-16">
          <div className="md:col-span-5">
            <div className="flex items-center gap-2.5 mb-5">
              <span className="inline-block h-2 w-2 rounded-full bg-ink" />
              <span className="font-display text-[15px] font-medium tracking-tight text-ink">
                Thundrly
              </span>
            </div>
            <p className="text-[15px] text-ink-soft max-w-sm leading-relaxed">
              Satın almadan önce 5 saniyelik akıllı kontrol. Türk e-ticaret kullanıcıları için
              tasarlanmış AI alışveriş asistanı.
            </p>
          </div>
          {cols.map((c) => {
            const isExternal = (href: string) => /^https?:\/\//.test(href);
            return (
              <div key={c.title} className="md:col-span-2">
                <div className="kicker mb-4">{c.title}</div>
                <ul className="space-y-2.5">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        {...(isExternal(l.href)
                          ? { target: "_blank", rel: "noopener noreferrer" }
                          : {})}
                        className="text-[14px] text-ink-soft hover:text-ink transition-colors"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="hairline mb-6" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="text-[12px] text-ink-muted">
            © {new Date().getFullYear()} Thundrly
          </div>
        </div>
      </Container>
    </footer>
  );
}
