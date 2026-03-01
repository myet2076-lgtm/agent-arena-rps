"use client";

import Image from "next/image";
import { Move } from "@/types";

const MOVE_ICONS: Record<string, string> = {
  [Move.ROCK]: "/icons/rock.svg",
  [Move.PAPER]: "/icons/paper.svg",
  [Move.SCISSORS]: "/icons/scissors.svg",
};

interface MoveIconProps {
  move: string | null | undefined;
  size?: number;
  className?: string;
}

export function MoveIcon({ move, size = 32, className }: MoveIconProps): React.JSX.Element | null {
  if (!move) return null;
  const src = MOVE_ICONS[move];
  if (!src) return <span>{move}</span>;
  return (
    <Image
      src={src}
      alt={move}
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: "pixelated" }}
      unoptimized
    />
  );
}
