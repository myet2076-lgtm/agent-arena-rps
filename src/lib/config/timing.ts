/**
 * Timing Constants — Single Source of Truth (PRD §4.5)
 * All modules MUST import from here. Never hardcode timing values.
 */

export const QUEUE_HEARTBEAT_SEC = 60;
export const READY_CHECK_SEC = 30;
export const COMMIT_SEC = 30;
export const REVEAL_SEC = 15;
export const ROUND_INTERVAL_SEC = 5;
export const READY_FORFEIT_ELO = -15;
