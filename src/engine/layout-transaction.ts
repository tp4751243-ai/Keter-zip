/**
 * v0.8.0 Part C (§8) — transactional layout-state manager.
 *
 * A preset/layout switch is a transaction, not a bare assignment: before
 * the new layout is applied, every piece of per-mode state left over from
 * the previous mode is reset, recalculated or explicitly carried over, and
 * the switch is validated so no stale geometry can survive.
 *
 * Why each rule (recorded choice):
 * - Shas-fix keep-together overrides (`keepTogetherUnitIds`) are
 *   Vilna-page-specific (a unit kept together on one Vilna folio has no
 *   meaning once the pagination is rebuilt for another layout) — DROPPED.
 * - Insert Page force-break overrides (`forcePageBreakBeforeUnitId`) are
 *   valid in every layout since Part C §6 (all paginators honour them) —
 *   CARRIED over.
 * - Other local overrides (role/style tweaks scoped to a unit) are layout
 *   independent — CARRIED over.
 * - Break instructions (drag-to-split) are anchored to page geometry
 *   (page index + word index inside a page) — DROPPED on any switch.
 * - Per-page custom-layout overrides are bound to page indices whose
 *   content changes meaning when the pagination is rebuilt — DROPPED on
 *   any switch. The global custom-layout box template is a layout asset
 *   and STAYS (it only renders in custom_layout mode).
 * - The selected / editing unit is cleared — its frame coordinates belong
 *   to the previous layout.
 * - The tiers are reset by `DesignSettingsEngine.updateLayoutSettings`
 *   (per-layout tier config) — not by this module.
 *
 * React re-derives the whole book (`bookDoc` useMemo in App) from the new
 * layout + settings, so no stale DOM coordinates can persist after the
 * transaction: there is no retained frame geometry outside the derived
 * pages. This module is the state half of the transaction; the re-derivation
 * is the geometry half.
 */
import type { BookLayoutType } from '../types/typesetter';
import type { LocalRuleOverride } from './typesetting-rules-engine';
import type { AnchoredBreakInstruction } from './break-instructions';

export interface LayoutSwitchInput {
  prevLayout: BookLayoutType;
  nextLayout: BookLayoutType;
  localOverrides: LocalRuleOverride[];
  breakInstructions: AnchoredBreakInstruction[];
  /** Whether any per-page custom-layout override exists right now. */
  hasCustomPageOverrides: boolean;
  selectedUnitId: string | null;
  editingUnitId: string | null;
}

export interface LayoutSwitchPlan {
  /** Local overrides that survive the switch (force-breaks + unit tweaks). */
  nextLocalOverrides: LocalRuleOverride[];
  /** Always empty on a switch — break instructions are geometry-bound. */
  nextBreakInstructions: AnchoredBreakInstruction[];
  /** True when per-page custom-layout overrides must be cleared. */
  clearCustomPageOverrides: boolean;
  /** Always true — the selection belongs to the previous layout. */
  clearSelection: boolean;
  /** Hebrew report lines for the toast (empty when nothing was reset). */
  report: string[];
  /** English report lines, same order and counts as `report`. */
  reportEn: string[];
}

export function planLayoutSwitch(input: LayoutSwitchInput): LayoutSwitchPlan {
  const report: string[] = [];
  const reportEn: string[] = [];

  // Shas-fix keep-together overrides are Vilna-page-specific — drop the
  // keep-together half. An override that ALSO carries a force-break keeps
  // its force-break half (force-breaks are valid in every layout).
  const nextLocalOverrides: LocalRuleOverride[] = [];
  let droppedKeepTogether = 0;
  for (const o of input.localOverrides) {
    if (o.keepTogetherUnitIds && o.keepTogetherUnitIds.length > 0) {
      droppedKeepTogether++;
      if (o.forcePageBreakBeforeUnitId) {
        const { keepTogetherUnitIds: _dropped, ...rest } = o;
        nextLocalOverrides.push(rest);
      }
    } else {
      nextLocalOverrides.push(o);
    }
  }
  if (droppedKeepTogether > 0) {
    report.push(
      `בוטלו ${droppedKeepTogether} כללי שמירת-יחד של ש״ס (שייכים לעימוד הקודם)`
    );
    reportEn.push(
      `Removed ${droppedKeepTogether} Shas keep-together rules (they belong to the previous layout)`
    );
  }
  const carriedForceBreaks = nextLocalOverrides.filter(
    o => o.forcePageBreakBeforeUnitId
  ).length;
  if (carriedForceBreaks > 0) {
    report.push(`נשמרו ${carriedForceBreaks} מעברי עמוד כפויים (תקפים בכל תבנית)`);
    reportEn.push(`Kept ${carriedForceBreaks} forced page breaks (valid in every template)`);
  }

  if (input.breakInstructions.length > 0) {
    report.push(
      `בוטלו ${input.breakInstructions.length} הוראות פיצול ידניות (קשורות לגאומטריית העמוד הקודם)`
    );
    reportEn.push(
      `Removed ${input.breakInstructions.length} manual split instructions (tied to the previous page geometry)`
    );
  }

  const clearCustomPageOverrides = input.hasCustomPageOverrides;
  if (clearCustomPageOverrides) {
    report.push('בוטלו התאמות פריסה לדפים בודדים (העמודים נבנים מחדש)');
    reportEn.push('Removed per-page layout overrides (the pages are rebuilt)');
  }

  const clearSelection =
    input.selectedUnitId !== null || input.editingUnitId !== null;
  if (clearSelection) {
    report.push('הבחירה הנוכחית בוטלה (המסגרת שייכת לתבנית הקודמת)');
    reportEn.push('Cleared the current selection (the frame belongs to the previous template)');
  }

  return {
    nextLocalOverrides,
    nextBreakInstructions: [],
    clearCustomPageOverrides,
    clearSelection,
    report,
    reportEn,
  };
}
