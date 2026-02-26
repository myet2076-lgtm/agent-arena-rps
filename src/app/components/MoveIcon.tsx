import { Move } from "@/types";
import styles from "./MoveIcon.module.css";

interface MoveIconProps {
  move: Move;
  animated?: boolean;
}

const iconMap: Record<Move, string> = {
  [Move.ROCK]: "✊",
  [Move.PAPER]: "✋",
  [Move.SCISSORS]: "✌️",
};

export function MoveIcon({ move, animated = true }: MoveIconProps): React.JSX.Element {
  return <span className={`${styles.icon} ${animated ? "slideIn" : ""}`}>{iconMap[move]}</span>;
}
