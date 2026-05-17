# /landing

"Kampanya Gerçek mi?" tanıtım sitesi. Next.js 15 (App Router), Tailwind v3, Framer Motion, lucide-react.

## Çalıştırma

```bash
cd landing
npm install
npm run dev
# http://localhost:3000
```

Üretim derlemesi:
```bash
npm run build
npm run start
```

## Yapı

```
landing/
├── app/
│   ├── layout.tsx       Fonts (Inter + Sora), Türkçe metadata
│   ├── page.tsx         10 bölümü sırayla derler
│   └── globals.css      Tailwind + özel renk değişkenleri + cam/grid efektleri
├── components/
│   ├── ui/              Button, Input, Card, Badge primitifleri
│   ├── sections/        10 bölümün her biri (Hero → Footer)
│   ├── demo/            ExtensionPanelMock, ProductPageMock, AgentFlowDiagram,
│   │                    AgentStepProgress, DecisionCard
│   └── shell/           Nav, Container
├── lib/
│   ├── palette.ts       Renk token'ları, karar etiketleri
│   ├── motion.ts        Framer variants (fadeUp, stagger, scaleIn)
│   ├── runDemo.ts       5 ajan ilerlemesini ~5s'de oynatan async iterator
│   └── cn.ts            clsx + tailwind-merge yardımcısı
└── tailwind.config.ts
```

## Demo Akışı

`#demo` bölümünde "Analizi Başlat" → `lib/runDemo.ts` her 900 ms'de bir ajanı `running` → `done` durumuna geçirir. Toplam ~5 saniye sonra `shared/demo/demoPayloads.ts` içindeki `redHoodieResponse` ile `DecisionCard` render edilir. "Yine de Devam Et" demoyu tekrar oynatır, "30 Saniye Düşün" sıfırlar.

## Path Alias

- `@/*` → `./` (landing kökü)
- `@shared/*` → `../shared/*` (ortak tipler + demo payload'lar)

## Tasarım Tokenları

`tailwind.config.ts` içinde:
- `bg-primary` `#0A0E1A` (koyu lacivert / siyaha yakın)
- `accent-green` `#22F5A3` · `accent-amber` `#FFB547` · `accent-red` `#FF5C7A`
- `accent-cyan` `#4FD8FF` · `accent-violet` `#9B7CFF`
- Cam karta `glass` / `glass-strong` utility class'ları

## Notlar

- Görsel 3D etki **React Three Fiber** yerine CSS 3D + Framer Motion ile yapıldı (bundle ~%40 daha küçük, dev maliyeti çok düşük).
- E-posta yakalama yalnızca yerel React state'te tutulur — sayfa yenilenince kaybolur.
- Tüm metinler Türkçedir; lorem ipsum yok.
