import type { AnalyzeRequest, AnalyzeResponse } from "../types/analysis";

export const redHoodieRequest: AnalyzeRequest = {
  userId: "demo-user",
  platform: "trendyol-demo",
  product: {
    title: "Oversize Siyah Hoodie",
    price: 990,
    originalPrice: 1650,
    currency: "TRY",
    category: "Giyim",
    rating: 4.7,
    reviewCount: 842,
    url: "https://demo.local/product/hoodie",
    imageUrl: "https://demo.local/img/hoodie.jpg",
  },
  reviews: [
    { rating: 5, text: "Çok güzel ürün hızlı kargo mükemmel kalite", date: "2026-05-10" },
    { rating: 5, text: "Çok güzel ürün hızlı kargo kalite süper", date: "2026-05-10" },
    { rating: 5, text: "Mükemmel kalite hızlı kargo tavsiye ederim", date: "2026-05-11" },
    { rating: 5, text: "Çok güzel kalite hızlı kargo", date: "2026-05-11" },
    { rating: 5, text: "Mükemmel ürün hızlı kargo süper kalite", date: "2026-05-11" },
    { rating: 5, text: "Tam istediğim gibi geldi tavsiye ederim", date: "2026-05-12" },
    { rating: 5, text: "Çok güzel ürün hızlı kargo mükemmel", date: "2026-05-12" },
    { rating: 2, text: "Beden uymadı, kumaş beklediğim gibi değildi.", date: "2026-04-15" },
  ],
  priceHistory: [
    { date: "2026-04-15", price: 780 },
    { date: "2026-04-22", price: 780 },
    { date: "2026-04-29", price: 820 },
    { date: "2026-05-05", price: 1650 },
    { date: "2026-05-10", price: 1650 },
    { date: "2026-05-14", price: 990 },
  ],
  userBudget: {
    monthlyLimit: 3000,
    categoryLimit: 1000,
    categorySpent: 1700,
    monthlySpent: 2400,
    currency: "TRY",
  },
  session: {
    timeOnPageSeconds: 18,
    clickSpeedMs: 420,
    currentHour: 23,
    purchasesToday: 2,
    searchedBefore: false,
  },
};

export const redHoodieResponse: AnalyzeResponse = {
  decision: "red",
  riskScore: 87,
  summary: "Bu satın alma yüksek riskli görünüyor.",
  reasons: [
    "Yorumlarda tekrarlayan ve şüpheli dil örüntüleri var.",
    "İndirim etiketi gerçek fiyat geçmişiyle uyumlu değil.",
    "Bu ay giyim bütçeni %170 aştın.",
  ],
  agents: {
    reviewAgent: {
      score: 78,
      label: "Şüpheli",
      findings: [
        { severity: "risk", message: "7 yorumda neredeyse aynı ifadeler tekrar ediyor." },
        { severity: "warn", message: "Yorumların %85'i son 4 günde yazılmış." },
      ],
    },
    priceAgent: {
      score: 82,
      label: "Manipülasyon Riski",
      findings: [
        { severity: "risk", message: "Fiyat 7 gün önce ₺780, indirim öncesi ₺1.650'ye çıkarılmış." },
        { severity: "warn", message: "30 günlük gerçek ortalama ₺880; ₺990 indirim sayılmaz." },
      ],
    },
    budgetAgent: {
      score: 90,
      label: "Bütçe Aşımı",
      findings: [
        { severity: "risk", message: "Giyim kategorisi aylık limitin %170'inde." },
        { severity: "risk", message: "Bu satın alma sonrası aylık bütçeyi %113 aşmış olacaksın." },
      ],
    },
    impulseAgent: {
      score: 73,
      label: "Dürtüsel Risk",
      findings: [
        { severity: "warn", message: "Ürün sayfasında 18 saniye geçirildi, tıklama 420 ms." },
        { severity: "warn", message: "Bugün zaten 2 satın alma yapıldı, saat 23:00." },
      ],
    },
    decisionAgent: {
      score: 87,
      label: "Kırmızı",
      findings: [
        { severity: "risk", message: "Tüm ajanlar yüksek risk sinyali veriyor." },
      ],
    },
  },
  recommendedAction: "30 saniye düşün",
};

export const yellowHeadphonesRequest: AnalyzeRequest = {
  userId: "demo-user",
  platform: "hepsiburada-demo",
  product: {
    title: "Kablosuz Kulaklık",
    price: 1450,
    originalPrice: 1899,
    currency: "TRY",
    category: "Elektronik",
    rating: 4.4,
    reviewCount: 312,
    url: "https://demo.local/product/headphones",
    imageUrl: "https://demo.local/img/headphones.jpg",
  },
  reviews: [
    { rating: 5, text: "Ses kalitesi beklediğimden iyi, gürültü engelleme başarılı.", date: "2026-05-09" },
    { rating: 4, text: "Pil ömrü iyi ama kulaklık biraz sıkıyor.", date: "2026-05-10" },
    { rating: 5, text: "Çok güzel ürün hızlı kargo.", date: "2026-05-11" },
    { rating: 5, text: "Hızlı kargo çok güzel mükemmel kalite.", date: "2026-05-12" },
    { rating: 3, text: "Mikrofon kalitesi orta, ses kalitesi iyi.", date: "2026-05-13" },
  ],
  priceHistory: [
    { date: "2026-04-15", price: 1199 },
    { date: "2026-04-25", price: 1199 },
    { date: "2026-05-01", price: 1899 },
    { date: "2026-05-08", price: 1899 },
    { date: "2026-05-14", price: 1450 },
  ],
  userBudget: {
    monthlyLimit: 3500,
    categoryLimit: 1500,
    categorySpent: 700,
    monthlySpent: 2100,
    currency: "TRY",
  },
  session: {
    timeOnPageSeconds: 28,
    clickSpeedMs: 900,
    currentHour: 22,
    purchasesToday: 1,
    searchedBefore: false,
  },
};

export const yellowHeadphonesResponse: AnalyzeResponse = {
  decision: "yellow",
  riskScore: 48,
  summary: "Devam etmeden önce birkaç noktayı kontrol et.",
  reasons: [
    "İndirimden önce fiyat son 30 günde yükseltilmiş; gerçek indirim oranı daha düşük.",
    "Bu satın alma sonrası elektronik kategorisi limitin %143'üne çıkacak.",
    "Yorumların %80'i son 4 günde yazılmış; örüntüye dikkat.",
  ],
  agents: {
    reviewAgent: {
      score: 34,
      label: "Büyük Ölçüde Güvenilir",
      findings: [
        { severity: "warn", message: "Yorumların %80'i son 4 günde yazılmış." },
        { severity: "info", message: "Bir kısmı jenerik 'hızlı kargo / çok güzel' ifadeleri içeriyor." },
      ],
    },
    priceAgent: {
      score: 49,
      label: "Kısmi Manipülasyon",
      findings: [
        { severity: "risk", message: "Fiyat son 30 gün ortalaması ₺1.529'iken indirim öncesi ₺1.899'a çıkarılmış." },
        { severity: "warn", message: "Etikette %24 indirim görünüyor; gerçek 30 günlük ortalamaya göre yaklaşık %5." },
      ],
    },
    budgetAgent: {
      score: 58,
      label: "Sınırda",
      findings: [
        { severity: "risk", message: "Bu satın alma sonrası elektronik kategorisi limitin %143'üne çıkacak (₺650 aşım)." },
        { severity: "warn", message: "Aylık bütçenin %101'i kullanılmış olacak." },
      ],
    },
    impulseAgent: {
      score: 50,
      label: "Karışık Sinyal",
      findings: [
        { severity: "warn", message: "Ürün sayfasında yalnızca 28 saniye geçirildi." },
        { severity: "warn", message: "Saat 22:00 — geç saatte verilen kararlar daha sık geri iade ediliyor." },
      ],
    },
    decisionAgent: {
      score: 48,
      label: "Sarı",
      findings: [
        { severity: "warn", message: "Ağırlıklı toplam 48; eşik sarı." },
      ],
    },
  },
  recommendedAction: "Birkaç noktayı tekrar gözden geçir",
};

export const greenBookRequest: AnalyzeRequest = {
  userId: "demo-user",
  platform: "n11-demo",
  product: {
    title: "Sapiens: Hayvanlardan Tanrılara",
    price: 145,
    originalPrice: 180,
    currency: "TRY",
    category: "Kitap",
    rating: 4.8,
    reviewCount: 5230,
    url: "https://demo.local/product/sapiens",
    imageUrl: "https://demo.local/img/sapiens.jpg",
  },
  reviews: [
    { rating: 5, text: "Yuval Noah Harari'nin bakış açısı çok geniş, akıcı bir kitap.", date: "2026-03-12" },
    { rating: 5, text: "İnsanlık tarihini tek kitapta toparlayan harika bir eser.", date: "2026-03-18" },
    { rating: 4, text: "Bazı bölümler tartışmaya açık ama düşündürücü.", date: "2026-04-02" },
    { rating: 5, text: "Çevirisi başarılı, kağıt kalitesi iyi.", date: "2026-04-22" },
  ],
  priceHistory: [
    { date: "2026-02-01", price: 160 },
    { date: "2026-03-01", price: 155 },
    { date: "2026-04-01", price: 165 },
    { date: "2026-05-01", price: 180 },
    { date: "2026-05-14", price: 145 },
  ],
  userBudget: {
    monthlyLimit: 2500,
    categoryLimit: 500,
    categorySpent: 80,
    monthlySpent: 600,
    currency: "TRY",
  },
  session: {
    timeOnPageSeconds: 210,
    clickSpeedMs: 2400,
    currentHour: 16,
    purchasesToday: 0,
    searchedBefore: true,
  },
};

export const greenBookResponse: AnalyzeResponse = {
  decision: "green",
  riskScore: 18,
  summary: "Bu satın alma düşük riskli görünüyor.",
  reasons: [
    "Yorumlar uzun zamana yayılmış ve detaylı.",
    "İndirim oranı 90 günlük ortalamayla tutarlı.",
    "Bütçende ve kategori limitinde rahatlıkla yer var.",
  ],
  agents: {
    reviewAgent: {
      score: 15,
      label: "Güvenilir",
      findings: [
        { severity: "info", message: "Yorumlar farklı yazarlar tarafından, yıllara yayılmış." },
      ],
    },
    priceAgent: {
      score: 22,
      label: "Gerçek İndirim",
      findings: [
        { severity: "info", message: "₺145 son 90 günün en düşük fiyatı." },
      ],
    },
    budgetAgent: {
      score: 8,
      label: "Bütçe İçinde",
      findings: [
        { severity: "info", message: "Kitap kategorisinde aylık limitin %16'sındasın." },
      ],
    },
    impulseAgent: {
      score: 12,
      label: "Planlı",
      findings: [
        { severity: "info", message: "Daha önce aratılmış, sayfada 3+ dakika geçirildi." },
      ],
    },
    decisionAgent: {
      score: 18,
      label: "Yeşil",
      findings: [
        { severity: "info", message: "Tüm ajanlar düşük risk veriyor." },
      ],
    },
  },
  recommendedAction: "Satın almaya devam edebilirsin",
};

export const demoPayloads = {
  red: { request: redHoodieRequest, response: redHoodieResponse },
  yellow: { request: yellowHeadphonesRequest, response: yellowHeadphonesResponse },
  green: { request: greenBookRequest, response: greenBookResponse },
} as const;

export type DemoVariant = keyof typeof demoPayloads;
