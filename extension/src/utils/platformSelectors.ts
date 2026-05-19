/**
 * Per-platform CSS selector packs for product extraction.
 *
 * Real Turkish e-commerce sites change DOM frequently; we list multiple
 * selectors per field in priority order. First match wins. If all selectors
 * miss, the higher-level extractor falls back to JSON-LD / microdata /
 * og:meta in order.
 *
 * These selectors are best-effort against the platforms as of early 2026.
 * For production, this whole module is a strong candidate to load from a
 * remote-config JSON so it can be updated without a Chrome Store release.
 */

import type { Host } from "./domDetector";

export interface PlatformPack {
  title: string[];
  price: string[];
  originalPrice: string[];
  category: string[];
  rating: string[];
  reviewCount: string[];
  imageUrl: string[];
  reviews?: ReviewSelectors;
}

export interface ReviewSelectors {
  /** Per-review wrapper. Each match is parsed as one Review. */
  container: string[];
  /** Element bearing the numeric rating (in textContent or an attr). */
  rating?: string[];
  /** Element holding the review body text. */
  text: string[];
  /** Element holding the date (ISO or platform-native string). */
  date?: string[];
  /** Element holding the reviewer name / handle. */
  author?: string[];
  /**
   * Element whose mere presence (or textContent) flags a verified-purchase
   * badge. When matched we set `verifiedPurchase: true`; absence is treated
   * as `null` (unknown), not false — many products show no badge at all.
   */
  verified?: string[];
  /** Element with a number indicating helpful votes / agreements. */
  helpful?: string[];
  /** Maximum reviews to extract per page (cap on payload size). */
  maxItems?: number;
}

export const PLATFORM_PACKS: Partial<Record<Host, PlatformPack>> = {
  trendyol: {
    title: [
      "h1[data-testid='product-title']",
      "h1.pr-new-br span",
      "h1.pr-new-br",
      ".product-detail-name",
      "h1.product-name",
    ],
    // Trendyol renames their price classes every few months; keep the
    // long form ordered newest → oldest. Microdata + meta tags are stable
    // and come last so a fresh class rename doesn't break us.
    price: [
      "[data-testid='discounted-price']",
      "[data-testid='price-current-price']",
      ".product-price-container .prc-dsc",
      ".product-price-container .prc-box-dscntd",
      ".featured-prices .featured-prices-discounted",
      ".featured-prices .prc-dsc",
      ".campaign-price-container .prc-dsc",
      ".product-price-container .price-view-current",
      ".product-price-container .prc-slg",
      "p.product-price",
      ".prc-dsc",
      ".price-current",
      "meta[itemprop='price']",
      "meta[property='product:price:amount']",
    ],
    originalPrice: [
      "[data-testid='price-original-price']",
      ".product-price-container .prc-org",
      ".product-price-container .prc-box-orgnl",
      ".featured-prices .featured-prices-original",
      ".prc-org",
      ".price-original",
      ".prc-box-orgnl",
    ],
    category: [
      ".breadcrumb-content a:last-of-type",
      ".product-detail-breadcrumb-link:last-of-type",
      ".breadcrumb li:nth-last-child(2) a",
    ],
    rating: [
      ".product-rating-score .value",
      ".pr-rnr-rating",
      "[data-testid='product-rating']",
      ".rating-line-count",
    ],
    reviewCount: [
      ".total-review-count",
      ".pr-rnr-cn",
      "[data-testid='review-count']",
    ],
    imageUrl: [
      ".gallery-modal-content img",
      ".product-image img",
      "img.product-detail-img",
    ],
    reviews: {
      // Container selectors — ordered most-specific to most-permissive.
      // Trendyol renames classes frequently; the wildcard tail catches
      // future renames so long as "comment" or "review" stays in the
      // class name somewhere.
      container: [
        ".comment-item",
        ".pr-rnr-cm-itm",
        ".rnr-com-cm",
        "[data-testid='review-card']",
        "[data-testid='comment-card']",
        "[class*='ReviewsList-item']",
        "[class*='ReviewCard']",
        "[class*='CommentItem']",
        "[class*='comment-item']",
        // Last-resort wildcard: any element whose class contains 'comment'
        // AND that has at least one text-bearing child. We filter junk
        // in `_extractOneReview` (containers without rating + text are
        // rejected).
        "[class*='comment']:not([class*='list']):not([class*='form']):not([class*='input'])",
      ],
      rating: [
        ".comment-rating",
        ".pr-rnr-com-r",
        ".rnr-com-r",
        "[data-testid='rating']",
        "[class*='RatingStars']",
        "[class*='ReviewCard-rating']",
        "[class*='star']",
        "[class*='Star']",
      ],
      text: [
        ".comment-text",
        ".pr-xc-w",
        ".rnr-com-tx",
        "[data-testid='review-text']",
        "[data-testid='comment-text']",
        "[class*='ReviewCard-text']",
        "[class*='CommentText']",
        "[class*='comment-text']",
        "p[class*='comment']",
        "p[class*='Comment']",
      ],
      date: [
        ".comment-date",
        ".pr-rnr-com-d",
        ".rnr-com-d",
        "[data-testid='review-date']",
        "[class*='ReviewCard-date']",
        "[class*='CommentDate']",
        "time",
      ],
      author: [
        ".comment-info-item",
        ".pr-rnr-com-usr",
        ".rnr-com-usr",
        "[data-testid='reviewer-name']",
        "[class*='ReviewCard-author']",
        "[class*='CommentUserName']",
      ],
      verified: [
        ".pr-xc-w-vr",
        "[class*='VerifiedPurchaseBadge']",
        "[class*='ConfirmedPurchase']",
        "[data-testid='verified-purchase']",
      ],
      helpful: [
        ".pr-xc-w-hlp .count",
        "[class*='HelpfulButton'] [class*='count']",
      ],
      maxItems: 100,
    },
  },

  hepsiburada: {
    title: [
      "h1[data-test-id='title']",
      "h1.product-name",
      "h1[itemprop='name']",
      ".product-detail h1",
    ],
    price: [
      "[data-test-id='price-current-price']",
      "[data-test-id='default-price']",
      "span[itemprop='price']",
      ".product-price",
      "[data-bind*='priceFormatter']",
    ],
    originalPrice: [
      "[data-test-id='price-prev-price']",
      ".price-prev",
      ".old-price",
      "del.product-old-price",
    ],
    category: [
      ".breadcrumb-list li:last-of-type a",
      ".breadcrumb li:nth-last-child(2) a",
      "[itemprop='itemListElement']:last-of-type [itemprop='name']",
    ],
    rating: [
      "[data-test-id='ratingScore']",
      ".rating-star span",
      "[itemprop='ratingValue']",
    ],
    reviewCount: [
      "[data-test-id='reviewCount']",
      ".review-count",
      "[itemprop='reviewCount']",
    ],
    imageUrl: [
      "#productImage img",
      ".product-image img",
      "img[data-test-id='product-image']",
    ],
    reviews: {
      container: [
        "[data-test-id='review-item']",
        ".reviews-list-item",
        ".user-reviews .review",
      ],
      rating: [
        "[data-test-id='review-rating']",
        "[itemprop='ratingValue']",
        ".review-stars",
      ],
      text: [
        "[data-test-id='review-text']",
        ".review-text",
        ".review-content",
      ],
      date: [
        "[data-test-id='review-date']",
        ".review-date",
        "time",
      ],
      author: [
        "[data-test-id='review-author']",
        ".review-author",
        ".reviewer-name",
      ],
      verified: [
        "[data-test-id='verified-purchase']",
        ".verified-purchase",
        ".verified-badge",
      ],
      helpful: [
        "[data-test-id='helpful-count']",
        ".helpful-count",
      ],
      maxItems: 100,
    },
  },

  n11: {
    title: [
      "h1.proName",
      ".product-detail-title h1",
      "h1[itemprop='name']",
      ".unf-p-summary-info h1",
    ],
    price: [
      ".newPrice ins",
      ".unf-p-new-price",
      ".product-price ins",
      "span[itemprop='price']",
      ".priceContainer .newPrice",
    ],
    originalPrice: [
      ".oldPrice del",
      ".unf-p-old-price",
      ".product-price del",
      ".oldPriceDetail",
    ],
    category: [
      ".breadCrumb li:last-of-type a",
      ".product-detail-breadcrumb a:last-of-type",
      ".unf-bread-item:last-of-type",
    ],
    rating: [
      ".ratingCont .ratingScore",
      ".rating-detail .point",
      "[itemprop='ratingValue']",
    ],
    reviewCount: [
      ".comment-count",
      ".reviewCountLink",
      "[itemprop='reviewCount']",
    ],
    imageUrl: [
      ".unf-p-img img",
      "#productMainImg img",
      ".productMainPic img",
    ],
    reviews: {
      container: [
        ".commentList .commentBox",
        ".comment-list .comment",
        "[class*='commentItem']",
      ],
      rating: [
        ".ratePoint",
        ".comment-stars",
        "[itemprop='ratingValue']",
      ],
      text: [
        ".commentDetail",
        ".comment-text",
      ],
      date: [
        ".commentDate",
        ".comment-date",
      ],
      author: [
        ".commentUserName",
        ".comment-user",
      ],
      verified: [
        ".verifiedPurchase",
        ".verified-badge",
      ],
      maxItems: 100,
    },
  },

  // ---------- Additional Turkish e-commerce sites ----------
  //
  // The packs below are intentionally lean. Most TR retailers publish a
  // Product JSON-LD block, which the extractor consults BEFORE these
  // selectors. We list the most reliable CSS hooks per site as a safety
  // net for pages where JSON-LD is incomplete or missing entirely.

  amazon: {
    title: ["#productTitle", "h1#title", "span#productTitle"],
    price: [
      ".a-price.priceToPay .a-offscreen",
      ".a-price .a-offscreen",
      "#priceblock_dealprice",
      "#priceblock_ourprice",
      "span.a-price-whole",
    ],
    originalPrice: [
      ".a-price.a-text-price .a-offscreen",
      ".priceBlockStrikePriceString",
      ".basisPrice .a-offscreen",
    ],
    category: [
      "#wayfinding-breadcrumbs_feature_div li:last-of-type a",
      "#wayfinding-breadcrumbs_container li:last-of-type",
    ],
    rating: ["#acrPopover .a-icon-alt", "span[data-hook='rating-out-of-text']", "i.a-icon-star span"],
    reviewCount: ["#acrCustomerReviewText", "[data-hook='total-review-count']"],
    imageUrl: ["#landingImage", "#imgBlkFront", "img#main-image"],
    reviews: {
      container: ["[data-hook='review']", ".review.aok-relative"],
      rating: ["[data-hook='review-star-rating'] .a-icon-alt", "i[data-hook='review-star-rating']"],
      text: ["[data-hook='review-body'] span", "[data-hook='review-body']"],
      date: ["[data-hook='review-date']"],
      maxItems: 20,
    },
  },

  ciceksepeti: {
    title: ["h1.product-name", "h1[data-test='product-title']"],
    price: [".product-price__current", ".product-price .current", "span[itemprop='price']"],
    originalPrice: [".product-price__old", ".product-price .old"],
    category: [".breadcrumb li:last-of-type a", ".breadcrumb-item:last-of-type"],
    rating: [".product-rating .rate", "[itemprop='ratingValue']"],
    reviewCount: [".product-rating .count", "[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  mediamarkt: {
    title: ["h1[data-test='mms-product-title']", "h1.product-title", "h1[itemprop='name']"],
    price: ["[data-test='branded-price-whole-value']", "span[data-test='price']", "span[itemprop='price']"],
    originalPrice: ["[data-test='branded-price-old']", ".old-price"],
    category: ["nav[aria-label='breadcrumb'] li:last-of-type a", ".breadcrumb li:last-of-type"],
    rating: ["[data-test='mms-customer-rating-value']", "[itemprop='ratingValue']"],
    reviewCount: ["[data-test='mms-customer-rating-count']", "[itemprop='reviewCount']"],
    imageUrl: ["picture img", "img[itemprop='image']"],
  },

  teknosa: {
    title: ["h1.pdp-title", "h1.product-name", "h1[itemprop='name']"],
    price: [".prc-box-dscntd", ".product-price .price", "span[itemprop='price']"],
    originalPrice: [".prc-box-sllng", ".old-price"],
    category: [".breadcrumb li:last-of-type a", ".breadcrumb-item:last-of-type a"],
    rating: [".product-rating .rate", "[itemprop='ratingValue']"],
    reviewCount: [".product-rating .count", "[itemprop='reviewCount']"],
    imageUrl: [".pdp-main-image img", ".product-image img"],
  },

  vatan: {
    title: ["h1.product-list__product-name", "h1.product-name", "h1[itemprop='name']"],
    price: [".product-list__price", ".product-price", "span[itemprop='price']"],
    originalPrice: [".product-list__old-price", ".old-price"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  boyner: {
    title: ["h1[data-testid='product-name']", "h1.product-name", "h1[itemprop='name']"],
    price: ["[data-testid='discounted-price']", ".discounted-price", "span[itemprop='price']"],
    originalPrice: ["[data-testid='strike-price']", ".old-price"],
    category: ["[data-testid='breadcrumb-item']:last-of-type", ".breadcrumb li:last-of-type a"],
    rating: ["[data-testid='product-rating']", "[itemprop='ratingValue']"],
    reviewCount: ["[data-testid='review-count']", "[itemprop='reviewCount']"],
    imageUrl: ["[data-testid='product-image'] img", ".product-image img"],
  },

  lcwaikiki: {
    title: ["h1.product-detail__product-name", "h1.product-name", "h1[itemprop='name']"],
    price: [".product-price__price", ".product-price ins", "span[itemprop='price']"],
    originalPrice: [".product-price__discounted", ".old-price", ".product-price del"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-gallery img", "img[itemprop='image']"],
  },

  defacto: {
    title: ["h1.product-title", "h1[itemprop='name']"],
    price: [".product-price .price", "span[itemprop='price']"],
    originalPrice: [".product-price .old-price", ".strike-price"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-gallery img", "img[itemprop='image']"],
  },

  modanisa: {
    title: ["h1.product-name", "h1[itemprop='name']"],
    price: [".price-discounted", ".product-price", "span[itemprop='price']"],
    originalPrice: [".price-original", ".old-price"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  a101: {
    title: ["h1.product-name", "h1[itemprop='name']"],
    price: [".product-price .current", "span[itemprop='price']"],
    originalPrice: [".product-price .old"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  migros: {
    title: ["h1.pdp-title", "h1[data-test='product-title']", "h1[itemprop='name']"],
    price: ["[data-test='product-price']", ".product-price .new", "span[itemprop='price']"],
    originalPrice: [".product-price .old", ".strike-price"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  carrefoursa: {
    title: ["h1.product-title", "h1[itemprop='name']"],
    price: [".product-price__current", ".price-current", "span[itemprop='price']"],
    originalPrice: [".product-price__old", ".price-old"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  beymen: {
    title: ["h1.o-productDetail__title", "h1.product-title", "h1[itemprop='name']"],
    price: [".o-productDetail__price .new", ".product-price__current", "span[itemprop='price']"],
    originalPrice: [".o-productDetail__price .old", ".product-price__old"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".o-productDetail__gallery img", ".product-image img"],
  },

  pazarama: {
    title: ["h1.product-title", "h1[itemprop='name']"],
    price: [".product-price .current-price", "span[itemprop='price']"],
    originalPrice: [".product-price .old-price"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  pttavm: {
    title: ["h1.product-title", "h1[itemprop='name']"],
    price: [".product-price .current", "span[itemprop='price']"],
    originalPrice: [".product-price .old"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  tchibo: {
    title: ["h1[data-tcid='product-name']", "h1.product-title", "h1[itemprop='name']"],
    price: ["[data-tcid='product-price']", ".product-price", "span[itemprop='price']"],
    originalPrice: ["[data-tcid='product-price-old']", ".old-price"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  decathlon: {
    title: ["h1[data-testid='product-name']", "h1.product-name", "h1[itemprop='name']"],
    price: ["[data-testid='product-price']", ".product-price__current", "span[itemprop='price']"],
    originalPrice: ["[data-testid='product-price-original']", ".product-price__old"],
    category: [".breadcrumb li:last-of-type a"],
    rating: ["[data-testid='product-rating']", "[itemprop='ratingValue']"],
    reviewCount: ["[data-testid='review-count']", "[itemprop='reviewCount']"],
    imageUrl: [".product-image img", "img[itemprop='image']"],
  },

  ikea: {
    title: ["h1.pip-header-section__title--big", "h1.product-pip__title", "h1[itemprop='name']"],
    price: [".pip-price__integer", ".pip-temp-price__integer", "span[itemprop='price']"],
    originalPrice: [".pip-price__previous", ".pip-temp-price__previous"],
    category: [".bc-breadcrumb__list li:last-of-type a"],
    rating: ["[itemprop='ratingValue']"],
    reviewCount: ["[itemprop='reviewCount']"],
    imageUrl: [".pip-media-grid img", "img[itemprop='image']"],
  },
};

export const DEMO_REVIEW_SELECTORS: ReviewSelectors = {
  // Demo product page is a static HTML file under our control — see
  // `public/demo-product.html`. Each review has explicit data-attrs so
  // extraction is deterministic regardless of CSS-class drift.
  container: ["[data-kg-review]"],
  rating: ["[data-kg-rating]"],
  text: ["[data-kg-review-text]"],
  date: [".review-date", "[data-kg-review-date]"],
  author: ["[data-kg-review-author]"],
  verified: ["[data-kg-review-verified]"],
  helpful: ["[data-kg-review-helpful]"],
  maxItems: 100,
};
