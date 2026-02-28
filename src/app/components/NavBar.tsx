"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./NavBar.module.css";

const links = [
  { href: "/", label: "Home" },
  { href: "/lobby", label: "Lobby" },
  { href: "/matches", label: "Matches" },
  { href: "/rankings", label: "Rankings" },
  { href: "/docs", label: "API Docs" },
] as const;

interface NavBarProps {
  mode?: "default" | "arena";
  waitingCount?: number;
  onRulesClick?: () => void;
  onPredictClick?: () => void;
  soundMuted?: boolean;
  onToggleSound?: () => void;
}

export function NavBar({ mode = "default", waitingCount = 0, onRulesClick, onPredictClick, soundMuted, onToggleSound }: NavBarProps): React.JSX.Element {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (mode === "arena") {
    return (
      <header className={styles.arenaHeader}>
        <div className={styles.arenaInner}>
          <div className={styles.arenaLogo}>⚔️ Agent Arena</div>
          <div className={styles.waitBadge}>⏳ {waitingCount} agents waiting</div>
          {onToggleSound && (
            <button type="button" className={styles.soundBtn} onClick={onToggleSound} aria-label={soundMuted ? "Unmute sounds" : "Mute sounds"} aria-pressed={!soundMuted}>
              {soundMuted ? "🔇" : "🔊"}
            </button>
          )}
          {onPredictClick && (
            <button type="button" className={styles.predictBtn} onClick={onPredictClick}>🔮 Predict</button>
          )}
          <button type="button" className={styles.rulesBtn} onClick={onRulesClick}>Rules</button>
        </div>
      </header>
    );
  }

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          ⚔️ Agent Arena
        </Link>
        <button
          type="button"
          className={styles.hamburger}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
        >
          <span className={`${styles.hamburgerBar} ${menuOpen ? styles.hamburgerOpen : ""}`} />
          <span className={`${styles.hamburgerBar} ${menuOpen ? styles.hamburgerOpen : ""}`} />
          <span className={`${styles.hamburgerBar} ${menuOpen ? styles.hamburgerOpen : ""}`} />
        </button>
        <nav className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`}>
          {links.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${styles.link} ${isActive ? styles.active : ""}`.trim()}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
