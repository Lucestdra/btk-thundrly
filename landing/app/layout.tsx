import type { Metadata, Viewport } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { Preloader } from "@/components/shell/Preloader";

const sans = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600"],
});

const display = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-display",
  display: "swap",
  weight: ["300", "400", "500", "600"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://tarti.local";

export const metadata: Metadata = {
  title: {
    default: "Tartı — Satın almadan önce 5 saniyelik akıllı kontrol",
    template: "%s · Tartı",
  },
  description:
    "Yorumları, fiyat geçmişini, bütçeni ve dürtüsel alışveriş riskini analiz ederek yeşil, sarı veya kırmızı bir karar veren Türk e-ticaret için AI alışveriş asistanı.",
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  keywords: [
    "Tartı",
    "akıllı alışveriş",
    "fiyat takip",
    "sahte indirim",
    "yorum analizi",
    "Trendyol",
    "Hepsiburada",
    "n11",
    "AI alışveriş asistanı",
    "Chrome eklentisi",
  ],
  authors: [{ name: "Tartı" }],
  category: "shopping",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "Tartı — Satın almadan önce 5 saniyelik akıllı kontrol",
    description:
      "Sahte indirimleri, manipüle yorumları ve bütçe aşımını tek ekranda yakala.",
    url: SITE_URL,
    siteName: "Tartı",
    locale: "tr_TR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tartı",
    description:
      "Satın almadan önce 5 saniyelik akıllı kontrol — Türk e-ticaret için AI alışveriş asistanı.",
  },
};

export const viewport: Viewport = {
  themeColor: "#ccdbdc",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${sans.variable} ${display.variable}`}>
      <body className="font-sans antialiased">
        <Preloader />
        {children}
      </body>
    </html>
  );
}
