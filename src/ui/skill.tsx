import type { SkillRange } from '../engine/types';

/** A recipe's skill levels in their in-game colors, orange first. A range without orange has three. */
export function SkillLevels({ range }: { range: SkillRange }) {
  const tiers = [
    ['orange', range.orange],
    ['yellow', range.yellow],
    ['green', range.green],
    ['grey', range.grey],
  ] as const;
  return (
    <span className="skill-levels" title="Orange, yellow, green and grey from these skill levels">
      {tiers
        .filter(([, n]) => n !== null)
        .map(([tier, n]) => (
          <span key={tier} className={`skill-${tier}`}>
            {n}
          </span>
        ))}
    </span>
  );
}
