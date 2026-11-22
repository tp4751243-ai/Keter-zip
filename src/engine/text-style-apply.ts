/**
 * v0.9.2 Part B — ONE handler for every text-style change.
 *
 * Font family, size, weight, tracking, baseline, alignment, leading and
 * indents used to be written through THREE different code paths that could
 * (and did) drift apart:
 *
 * - FloatingContextToolbar.applyCharChange/applyParaChange — word >
 *   unit > role routing, no hard-rule guard.
 * - DesignTypesettingPanel.handleUpdateChar/handleUpdatePara — the same
 *   routing, but driven by an explicit scopeLevel and WITH the
 *   sanitizeAndEnforceHardRules guard.
 * - ControlPanel.patchRole — role-only via updateRoleStyle, ignoring
 *   whatever was selected, and the ONLY place that wrote an absolute
 *   leadingPt (which then shadowed lineSpacingRatio in the resolver, so
 *   the floating toolbar's leading stepper silently stopped working
 *   after a Control Panel leading edit).
 *
 * Every writer now calls these two functions. The routing is the same in
 * all of them — a selected word wins, else the selected unit, else the
 * role style for the whole book — and the hard-rule guard runs for every
 * write, so a change made in one place can never produce a state another
 * place would have clamped. Callers only decide the TARGET (which word /
 * unit / role); the engine call itself lives here, once.
 *
 * The Control Panel no longer writes text styles at all (it is now the
 * frame-geometry panel); the keyboard font-size shortcut in App routes
 * through here too.
 */
import { DesignSettingsEngine } from './design-settings-engine';
import type {
  CharacterStyleSettings,
  ParagraphStyleSettings,
  ProfessionalDesignSettings,
  SemanticStyleRole,
} from '../types/design-settings';

/**
 * Where a style change lands. `wordIndex` set ⇒ that word inside the
 * unit; `unitId` set (no wordIndex) ⇒ the whole unit as a local override;
 * neither set ⇒ the role style for the whole book.
 */
export interface TextStyleTarget {
  role: SemanticStyleRole;
  unitId?: string;
  wordIndex?: number;
}

export function applyCharacterStyleChange(
  designSettings: ProfessionalDesignSettings,
  target: TextStyleTarget,
  patch: Partial<CharacterStyleSettings>
): ProfessionalDesignSettings {
  let next: ProfessionalDesignSettings;
  if (target.wordIndex !== undefined && target.unitId !== undefined) {
    next = DesignSettingsEngine.setLocalWordOverride(
      designSettings,
      target.unitId,
      target.wordIndex,
      patch,
      'user'
    );
  } else if (target.unitId !== undefined) {
    next = DesignSettingsEngine.setLocalUnitOverride(
      designSettings,
      target.unitId,
      { character: patch },
      'user'
    );
  } else {
    next = DesignSettingsEngine.updateRoleCharacterStyle(
      designSettings,
      target.role,
      patch,
      'user'
    );
  }
  return DesignSettingsEngine.sanitizeAndEnforceHardRules(next).settings;
}

export function applyParagraphStyleChange(
  designSettings: ProfessionalDesignSettings,
  target: TextStyleTarget,
  patch: Partial<ParagraphStyleSettings>
): ProfessionalDesignSettings {
  let next: ProfessionalDesignSettings;
  if (target.unitId !== undefined) {
    next = DesignSettingsEngine.setLocalUnitOverride(
      designSettings,
      target.unitId,
      { paragraph: patch },
      'user'
    );
  } else {
    next = DesignSettingsEngine.updateRoleParagraphStyle(
      designSettings,
      target.role,
      patch,
      'user'
    );
  }
  return DesignSettingsEngine.sanitizeAndEnforceHardRules(next).settings;
}
