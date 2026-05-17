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
    title: str
    price: float
    originalPrice: Optional[float] = None
    currency: Currency = "TRY"
    category: str
    rating: Optional[float] = None
    reviewCount: Optional[int] = None
    url: str
    imageUrl: Optional[str] = None


class Review(BaseModel):
    rating: float
    text: str
    date: str
    author: Optional[str] = None


class PriceHistoryPoint(BaseModel):
    date: str
    price: float


class UserBudget(BaseModel):
    monthlyLimit: float
    categoryLimit: float
    categorySpent: float
    monthlySpent: Optional[float] = None
    currency: Currency = "TRY"


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
    # When omitted, the backend resolves the budget for (userId,
    # product.category) from the `user_budgets` table — falling back to a
    # permissive default if no row exists.
    userBudget: Optional[UserBudget] = None
    session: SessionContext


class AgentFinding(BaseModel):
    severity: Severity
    message: str


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


class AnalyzeResponse(BaseModel):
    decision: Decision
    riskScore: int = Field(ge=0, le=100)
    summary: str
    reasons: List[str]
    agents: AgentResultMap
    recommendedAction: str


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
