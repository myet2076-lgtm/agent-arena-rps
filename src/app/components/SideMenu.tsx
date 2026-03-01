import styles from "./SideMenu.module.css";

interface SideMenuProps {
  collapsed: boolean;
  onToggle: () => void;
  onOpenRegister: () => void;
  onOpenRankings: () => void;
  onOpenDocs: () => void;
  onOpenPolymarket: () => void;
}

export function SideMenu({
  collapsed,
  onToggle,
  onOpenRegister,
  onOpenRankings,
  onOpenDocs,
  onOpenPolymarket,
}: SideMenuProps): React.JSX.Element {
  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.collapsedTrigger}
        onClick={onToggle}
        aria-label="Open side menu"
      >
        ☰
      </button>
    );
  }

  return (
    <aside className={styles.panel}>
      <button type="button" className={styles.close} onClick={onToggle} aria-label="Collapse side menu">
        ❯
      </button>
      <h2 className={styles.title}>Arena Menu</h2>
      <button type="button" className={styles.item} onClick={onOpenRankings}>🏆 Rankings</button>
      <button type="button" className={styles.item} onClick={onOpenDocs}>📄 Docs</button>
      <button type="button" className={styles.item} onClick={onOpenPolymarket}>📊 Polymarket</button>
    </aside>
  );
}
