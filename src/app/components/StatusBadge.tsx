import { MatchStatus } from "@/types";
import styles from "./StatusBadge.module.css";

interface StatusBadgeProps {
  status: MatchStatus;
}

const statusLabel: Record<MatchStatus, string> = {
  [MatchStatus.CREATED]: "CREATED",
  [MatchStatus.RUNNING]: "LIVE",
  [MatchStatus.FINISHED]: "FINISHED",
  [MatchStatus.ARCHIVED]: "ARCHIVED",
};

export function StatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      {statusLabel[status]}
    </span>
  );
}
