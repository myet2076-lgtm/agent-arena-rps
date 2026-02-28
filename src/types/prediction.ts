/**
 * Prediction Draft — frontend-only data model for Phase 4 Polymarket readiness.
 */
export interface PredictionDraft {
  matchId: string | null;
  side: "A" | "B" | null;
  confidence: "low" | "medium" | "high";
  email?: string;
  createdAt: string;
}
