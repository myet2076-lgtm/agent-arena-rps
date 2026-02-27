import { checkCommitTimeout, checkRevealTimeout } from "@/lib/fairness/timeout";
import { db } from "@/lib/server/in-memory-db";
import { type Match, RULES } from "@/types";

export interface TimeoutCheck {
  timedOut: boolean;
  forfeitAgentId: string | null;
}

export function checkRoundTimeouts(matchId: string, roundNo: number, match: Match): TimeoutCheck {
  const now = new Date();
  const commitA = db.getCommit(matchId, roundNo, match.agentA);
  const commitB = db.getCommit(matchId, roundNo, match.agentB);

  if (commitA && !commitB && checkCommitTimeout(commitA, now)) {
    return { timedOut: true, forfeitAgentId: match.agentB };
  }

  if (commitB && !commitA && checkCommitTimeout(commitB, now)) {
    return { timedOut: true, forfeitAgentId: match.agentA };
  }

  if (commitA && commitB) {
    const revealA = db.getReveal(matchId, roundNo, match.agentA);
    const revealB = db.getReveal(matchId, roundNo, match.agentB);
    const revealDeadline = new Date(
      Math.max(commitA.committedAt.getTime(), commitB.committedAt.getTime()) + RULES.REVEAL_TIMEOUT_MS,
    );

    if (revealA && !revealB && checkRevealTimeout(revealDeadline, now)) {
      return { timedOut: true, forfeitAgentId: match.agentB };
    }

    if (revealB && !revealA && checkRevealTimeout(revealDeadline, now)) {
      return { timedOut: true, forfeitAgentId: match.agentA };
    }
  }

  return { timedOut: false, forfeitAgentId: null };
}
