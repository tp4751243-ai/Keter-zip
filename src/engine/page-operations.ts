/**
 * v0.7.0 (integrator) — pure page operations used by the Pages Panel.
 * Kept pure (no React) so the v0.7.0 smoke test can verify the reorder
 * against real data instead of trusting the JSX.
 */
import type { ContentUnit } from '../types/typesetter';

/**
 * Move the units of one page to a new position in reading order.
 * `movingIds` are the units typeset on the source page (in order);
 * `targetIds` are the units of the destination page. Moving down inserts
 * after the destination page's last unit; moving up inserts before its
 * first unit. Units not involved keep their relative order.
 */
export function reorderPageUnits(
  units: ContentUnit[],
  movingIds: string[],
  targetIds: string[],
  fromIndex: number,
  toIndex: number
): ContentUnit[] {
  if (movingIds.length === 0 || fromIndex === toIndex) return units;
  const moving = units.filter(u => movingIds.includes(u.id));
  const rest = units.filter(u => !movingIds.includes(u.id));
  const anchorId = fromIndex < toIndex ? targetIds[targetIds.length - 1] : targetIds[0];
  const anchorIdx = rest.findIndex(u => u.id === anchorId);
  if (anchorIdx < 0) return [...rest, ...moving];
  const at = fromIndex < toIndex ? anchorIdx + 1 : anchorIdx;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}
