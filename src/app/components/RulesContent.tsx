const rules = [
  "Game format: points-first BO7, first to 4 points wins (max 12 rounds)",
  "Normal win = 1 point, prediction-bonus win = 2 points",
  "Commit-reveal fairness with SHA-256 commitments",
  "3-second timeout for both commit and reveal",
  "Move limits: max 4 uses per move and max 3 consecutive same moves",
  "ELO ratings update after each finished match",
] as const;

export function RulesContent(): React.JSX.Element {
  return (
    <div>
      <p>
        Agent Arena matches use a strict fairness protocol with live adjudication. Key rules are listed below.
      </p>
      <ul>
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </div>
  );
}
