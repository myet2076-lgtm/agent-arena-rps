import { type HighlightRound, type Match, type MatchDTO, type MatchSummary, type Round, type RoundDTO, RoundOutcome, RULES } from "@/types";

function leader(scoreA: number, scoreB: number): "A" | "B" | "TIE" {
  if (scoreA === scoreB) return "TIE";
  return scoreA > scoreB ? "A" : "B";
}

export function extractHighlights(match: Match | MatchDTO, rounds: Array<Round | RoundDTO>): HighlightRound[] {
  let scoreA = 0;
  let scoreB = 0;
  let previousLeader: "A" | "B" | "TIE" = "TIE";
  let lastNonTieLeader: "A" | "B" | null = null;
  let consecutiveReadA = 0;
  let consecutiveReadB = 0;

  const highlights: HighlightRound[] = [];

  for (const round of rounds.sort((a, b) => a.roundNo - b.roundNo)) {
    scoreA += round.pointsA;
    scoreB += round.pointsB;

    const currentLeader = leader(scoreA, scoreB);

    const effectivePriorLeader: "A" | "B" | null = previousLeader === "TIE" ? lastNonTieLeader : previousLeader;
    if (effectivePriorLeader && currentLeader !== "TIE" && currentLeader !== effectivePriorLeader) {
      const deficit = Math.abs((scoreA - round.pointsA) - (scoreB - round.pointsB));
      highlights.push({
        roundNo: round.roundNo,
        type: "REVERSAL",
        dramaScore: 70 + Math.min(20, deficit * 8),
        reason: `Lead flips from ${effectivePriorLeader} to ${currentLeader}`,
      });
    }

    if (round.predictionBonusA || round.predictionBonusB) {
      if (round.predictionBonusA) {
        consecutiveReadA += 1;
        consecutiveReadB = 0;
      }
      if (round.predictionBonusB) {
        consecutiveReadB += 1;
        consecutiveReadA = 0;
      }

      const streak = Math.max(consecutiveReadA, consecutiveReadB);
      highlights.push({
        roundNo: round.roundNo,
        type: "READ_BONUS",
        dramaScore: 65 + Math.min(30, streak * 10),
        reason: streak > 1 ? `Consecutive read-bonus streak x${streak}` : "Read-bonus triggered",
      });
    } else {
      consecutiveReadA = 0;
      consecutiveReadB = 0;
    }

    const preA = scoreA - round.pointsA;
    const preB = scoreB - round.pointsB;
    const atMatchPointA = preA === RULES.WIN_THRESHOLD - 1;
    const atMatchPointB = preB === RULES.WIN_THRESHOLD - 1;

    if (atMatchPointA || atMatchPointB) {
      highlights.push({
        roundNo: round.roundNo,
        type: "MATCH_POINT",
        dramaScore: 80 + (round.pointsA === 2 || round.pointsB === 2 ? 10 : 0),
        reason: "Decisive match-point round",
      });
    }

    const clutchWinA = atMatchPointB && round.outcome === RoundOutcome.WIN_A;
    const clutchWinB = atMatchPointA && round.outcome === RoundOutcome.WIN_B;
    if (clutchWinA || clutchWinB) {
      highlights.push({
        roundNo: round.roundNo,
        type: "CLUTCH",
        dramaScore: 95,
        reason: "Clutch deny at opponent match-point",
      });
    }

    if (currentLeader !== "TIE") {
      lastNonTieLeader = currentLeader;
    }
    previousLeader = currentLeader;
  }

  return highlights.sort((a, b) => b.dramaScore - a.dramaScore || a.roundNo - b.roundNo);
}

export function generateMatchSummary(match: Match | MatchDTO, rounds: Array<Round | RoundDTO>, highlights: HighlightRound[]): MatchSummary {
  let maxLeadA = 0;
  let maxLeadB = 0;
  let scoreA = 0;
  let scoreB = 0;
  let swings = 0;
  let prevLeader: "A" | "B" | "TIE" = "TIE";

  for (const r of rounds.sort((a, b) => a.roundNo - b.roundNo)) {
    scoreA += r.pointsA;
    scoreB += r.pointsB;
    maxLeadA = Math.max(maxLeadA, scoreA - scoreB);
    maxLeadB = Math.max(maxLeadB, scoreB - scoreA);

    const currLeader = leader(scoreA, scoreB);
    if (prevLeader !== "TIE" && currLeader !== "TIE" && prevLeader !== currLeader) swings += 1;
    prevLeader = currLeader;
  }

  const predictionBonusCount = rounds.filter((r) => r.predictionBonusA || r.predictionBonusB).length;

  return {
    matchId: match.id,
    winnerId: match.winnerId,
    finalScoreA: match.scoreA,
    finalScoreB: match.scoreB,
    roundsPlayed: rounds.length,
    predictionBonusCount,
    largestComeback: Math.max(maxLeadA, maxLeadB),
    momentumSwings: swings,
    topHighlights: highlights.slice(0, 5),
  };
}
