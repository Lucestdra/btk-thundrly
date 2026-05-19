"""
Pydantic v2 modelleri.

`shared/types/*.ts` içindeki TypeScript tiplerini birebir aynalar.
Sözleşme değişirse iki yerin de güncellenmesi gerekir; `docs/api-contract.md` referans alınmalıdır.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

Currency = Literal["TRY", "USD", "EUR"]
Decision = Literal["green", "yellow", "red"]
Severity = Literal["info", "warn", "risk"]


class Product(BaseModel):
    # Free-form fields capped to prevent a hostile content-script
    # from shipping a megabyte of garbage and forcing the agent path
    # to chew on it. Caps are generous (real titles are well under).
    title: str = Field(min_length=1, max_length=512)
    price: float = Field(ge=0, lt=10_000_000)
    originalPrice: Optional[float] = Field(default=None, ge=0, lt=10_000_000)
    currency: Currency = "TRY"
    category: str = Field(min_length=1, max_length=128)
    rating: Optional[float] = Field(default=None, ge=0, le=5)
    reviewCount: Optional[int] = Field(default=None, ge=0, lt=10_000_000)
    url: str = Field(min_length=8, max_length=2048)
    imageUrl: Optional[str] = Field(default=None, max_length=2048)
    # On-page "son 30 günün en düşük fiyatı" disclosure required by
    # Turkish consumer-protection regulation. When present, this is the
    # strongest single source of truth for cross-checking inflated
    # original-price claims. Extension parses it; backend cross-checks
    # against our own history and Akakçe data.
    legalLowestPrice30d: Optional[float] = None


class Review(BaseModel):
    rating: float = Field(ge=0, le=5)
    # 2 KB is well above any real review (TR sites cap user input at
    # 500-1500 chars) and small enough that a 100-review payload stays
    # under 200 KB.
    text: str = Field(min_length=1, max_length=2048)
    date: str = Field(max_length=32)
    author: Optional[str] = Field(default=None, max_length=128)
    # Trust signals — present when the platform exposes them, omitted
    # otherwise. The review_agent folds these into its trust score
    # (verified-purchase ratio, helpful-vote signal, author repetition).
    verifiedPurchase: Optional[bool] = None
    helpfulCount: Optional[int] = None


class PriceHistoryPoint(BaseModel):
    date: str
    price: float


class PriceComparisonOffer(BaseModel):
    """Current-market offer from an external comparison/search source."""

    source: str = Field(min_length=1, max_length=96)
    price: float = Field(gt=0, lt=10_000_000)
    title: Optional[str] = Field(default=None, max_length=512)
    url: Optional[str] = Field(default=None, max_length=2048)


class UserBudget(BaseModel):
    # Bounds: same ceiling as PriceObservationIn.price for consistency.
    # Negative limits are nonsensical; lower-bound is gt=0 so empty
    # "categoryLimit: 0" updates from the popup intentionally clear a
    # row's per-category cap by deleting/re-upserting, not by writing 0.
    monthlyLimit: float = Field(gt=0, lt=10_000_000)
    categoryLimit: float = Field(ge=0, lt=10_000_000)
    categorySpent: float = Field(ge=0, lt=10_000_000)
    monthlySpent: Optional[float] = Field(default=None, ge=0, lt=10_000_000)
    currency: Currency = "TRY"


class CategoryBudget(BaseModel):
    """One row in the user's budget — name + limit + current-period spend."""
    category: str
    categoryLimit: float
    categorySpent: float


class UserBudgetSummary(BaseModel):
    """All of a user's budget data, suitable for the popup UI."""
    userId: str
    monthlyLimit: float
    monthlySpent: float
    currency: Currency = "TRY"
    periodStart: str  # ISO date, "YYYY-MM-01"
    categories: List[CategoryBudget]


class SessionContext(BaseModel):
    timeOnPageSeconds: float
    clickSpeedMs: float
    currentHour: int = Field(ge=0, le=23)
    purchasesToday: int = Field(ge=0)
    searchedBefore: Optional[bool] = None


class AnalyzeRequest(BaseModel):
    userId: str
    platform: str
    product: Product
    reviews: List[Review] = Field(default_factory=list)
    priceHistory: List[PriceHistoryPoint] = Field(default_factory=list)
    priceComparisons: List[PriceComparisonOffer] = Field(default_factory=list)
    # When omitted, the backend resolves the budget for (userId,
    # product.category) from the `user_budgets` table — falling back to a
    # permissive default if no row exists.
    userBudget: Optional[UserBudget] = None
    session: SessionContext


class AgentFinding(BaseModel):
    severity: Severity
    message: str
    # Optional machine-readable tag so the frontend can render special
    # visual treatments (badges, chips) without parsing free-form
    # Turkish prose. Known tags: "suspiciousDiscount", "lowReviewTrust".
    tag: Optional[str] = None


class AgentResult(BaseModel):
    score: int = Field(ge=0, le=100)
    label: str
    findings: List[AgentFinding] = Field(default_factory=list)


class AgentResultMap(BaseModel):
    reviewAgent: AgentResult
    priceAgent: AgentResult
    budgetAgent: AgentResult
    impulseAgent: AgentResult
    decisionAgent: AgentResult


class TriggeredRule(BaseModel):
    """One causal rule that fired in the decision pass.

    The rule engine evaluates AND/OR combinations over tagged findings
    (e.g. ``suspiciousDiscount + lowReviewTrust``) and emits one of these
    for each rule it triggered. The panel renders them as a small
    "Tetiklenen kurallar" section so the user can see WHY the verdict
    landed where it did beyond the bare risk score.
    """
    name: str = Field(min_length=1, max_length=64)
    severity: Severity
    explanation: str = Field(min_length=1, max_length=240)


class AnalyzeResponse(BaseModel):
    decision: Decision
    riskScore: int = Field(ge=0, le=100)
    summary: str
    reasons: List[str]
    agents: AgentResultMap
    recommendedAction: str
    # Causal rules that fired on top of the weighted-sum score. Empty
    # when only the linear combination drove the verdict. Optional
    # default makes the field backwards-compatible.
    triggeredRules: List[TriggeredRule] = Field(default_factory=list)


class PriceObservationIn(BaseModel):
    """Payload from the extension on every product-page load."""

    url: str = Field(min_length=8, max_length=1024)
    price: float = Field(gt=0, lt=10_000_000)
    currency: Currency = "TRY"
    title: Optional[str] = Field(default=None, max_length=512)


class PriceObservationOut(BaseModel):
    """Acknowledgement returned to the extension."""

    ok: bool = True
    canonicalUrl: str
    platform: str
    storedAt: str  # ISO 8601 UTC


class PurchaseIn(BaseModel):
    """Recorded when the user clicks 'Yine de Devam Et' in the panel.

    Treated as a committed purchase; the backend bumps the running
    `category_spent` total for (userId, category) by `amount`.
    """

    userId: str = Field(min_length=1, max_length=64)
    category: str = Field(min_length=1, max_length=64)
    amount: float = Field(gt=0, lt=10_000_000)
    currency: Currency = "TRY"


class PurchaseOut(BaseModel):
    ok: bool = True
    userId: str
    category: str
    categorySpent: float
    monthlySpent: float
    categoryLimit: float
    monthlyLimit: float
    periodStart: str  # ISO 8601 date
