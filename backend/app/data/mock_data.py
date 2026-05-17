"""
shared/demo/demoPayloads.ts ile birebir eşleşen Python sözlükleri.

Test ve Swagger /docs örneklerinde kullanılır.
Bu dosya bağımsız (Pydantic'e bağımlı değil) — testler doğrudan model'e parse eder.
"""

from __future__ import annotations

from typing import Any, Dict

red_hoodie_request: Dict[str, Any] = {
    "userId": "demo-user",
    "platform": "trendyol-demo",
    "product": {
        "title": "Oversize Siyah Hoodie",
        "price": 990,
        "originalPrice": 1650,
        "currency": "TRY",
        "category": "Giyim",
        "rating": 4.7,
        "reviewCount": 842,
        "url": "https://demo.local/product/hoodie",
        "imageUrl": "https://demo.local/img/hoodie.jpg",
    },
    "reviews": [
        {"rating": 5, "text": "Çok güzel ürün hızlı kargo mükemmel kalite", "date": "2026-05-10"},
        {"rating": 5, "text": "Çok güzel ürün hızlı kargo kalite süper", "date": "2026-05-10"},
        {"rating": 5, "text": "Mükemmel kalite hızlı kargo tavsiye ederim", "date": "2026-05-11"},
        {"rating": 5, "text": "Çok güzel kalite hızlı kargo", "date": "2026-05-11"},
        {"rating": 5, "text": "Mükemmel ürün hızlı kargo süper kalite", "date": "2026-05-11"},
        {"rating": 5, "text": "Tam istediğim gibi geldi tavsiye ederim", "date": "2026-05-12"},
        {"rating": 5, "text": "Çok güzel ürün hızlı kargo mükemmel", "date": "2026-05-12"},
        {"rating": 2, "text": "Beden uymadı, kumaş beklediğim gibi değildi.", "date": "2026-04-15"},
    ],
    "priceHistory": [
        {"date": "2026-04-15", "price": 780},
        {"date": "2026-04-22", "price": 780},
        {"date": "2026-04-29", "price": 820},
        {"date": "2026-05-05", "price": 1650},
        {"date": "2026-05-10", "price": 1650},
        {"date": "2026-05-14", "price": 990},
    ],
    "userBudget": {
        "monthlyLimit": 3000,
        "categoryLimit": 1000,
        "categorySpent": 1700,
        "monthlySpent": 2400,
        "currency": "TRY",
    },
    "session": {
        "timeOnPageSeconds": 18,
        "clickSpeedMs": 420,
        "currentHour": 23,
        "purchasesToday": 2,
        "searchedBefore": False,
    },
}

yellow_headphones_request: Dict[str, Any] = {
    "userId": "demo-user",
    "platform": "hepsiburada-demo",
    "product": {
        "title": "Kablosuz Kulaklık",
        "price": 1450,
        "originalPrice": 1899,
        "currency": "TRY",
        "category": "Elektronik",
        "rating": 4.4,
        "reviewCount": 312,
        "url": "https://demo.local/product/headphones",
        "imageUrl": "https://demo.local/img/headphones.jpg",
    },
    "reviews": [
        {"rating": 5, "text": "Ses kalitesi beklediğimden iyi, gürültü engelleme başarılı.", "date": "2026-05-09"},
        {"rating": 4, "text": "Pil ömrü iyi ama kulaklık biraz sıkıyor.", "date": "2026-05-10"},
        {"rating": 5, "text": "Çok güzel ürün hızlı kargo.", "date": "2026-05-11"},
        {"rating": 5, "text": "Hızlı kargo çok güzel mükemmel kalite.", "date": "2026-05-12"},
        {"rating": 3, "text": "Mikrofon kalitesi orta, ses kalitesi iyi.", "date": "2026-05-13"},
    ],
    "priceHistory": [
        {"date": "2026-04-15", "price": 1199},
        {"date": "2026-04-25", "price": 1199},
        {"date": "2026-05-01", "price": 1899},
        {"date": "2026-05-08", "price": 1899},
        {"date": "2026-05-14", "price": 1450},
    ],
    "userBudget": {
        "monthlyLimit": 3500,
        "categoryLimit": 1500,
        "categorySpent": 700,
        "monthlySpent": 2100,
        "currency": "TRY",
    },
    "session": {
        "timeOnPageSeconds": 28,
        "clickSpeedMs": 900,
        "currentHour": 22,
        "purchasesToday": 1,
        "searchedBefore": False,
    },
}

green_book_request: Dict[str, Any] = {
    "userId": "demo-user",
    "platform": "n11-demo",
    "product": {
        "title": "Sapiens: Hayvanlardan Tanrılara",
        "price": 145,
        "originalPrice": 180,
        "currency": "TRY",
        "category": "Kitap",
        "rating": 4.8,
        "reviewCount": 5230,
        "url": "https://demo.local/product/sapiens",
        "imageUrl": "https://demo.local/img/sapiens.jpg",
    },
    "reviews": [
        {"rating": 5, "text": "Yuval Noah Harari'nin bakış açısı çok geniş, akıcı bir kitap.", "date": "2026-03-12"},
        {"rating": 5, "text": "İnsanlık tarihini tek kitapta toparlayan harika bir eser.", "date": "2026-03-18"},
        {"rating": 4, "text": "Bazı bölümler tartışmaya açık ama düşündürücü.", "date": "2026-04-02"},
        {"rating": 5, "text": "Çevirisi başarılı, kağıt kalitesi iyi.", "date": "2026-04-22"},
    ],
    "priceHistory": [
        {"date": "2026-02-01", "price": 160},
        {"date": "2026-03-01", "price": 155},
        {"date": "2026-04-01", "price": 165},
        {"date": "2026-05-01", "price": 180},
        {"date": "2026-05-14", "price": 145},
    ],
    "userBudget": {
        "monthlyLimit": 2500,
        "categoryLimit": 500,
        "categorySpent": 80,
        "monthlySpent": 600,
        "currency": "TRY",
    },
    "session": {
        "timeOnPageSeconds": 210,
        "clickSpeedMs": 2400,
        "currentHour": 16,
        "purchasesToday": 0,
        "searchedBefore": True,
    },
}

EXAMPLES = {
    "red": red_hoodie_request,
    "yellow": yellow_headphones_request,
    "green": green_book_request,
}
