/**
 * v0.7.0 Part 1 (M2) — InDesign-style context-aware Control Panel (top ribbon).
 *
 * v0.9.2 Part B — this panel is now ONLY the frame-geometry panel. It
 * used to duplicate the whole text-formatting set (font family, size,
 * leading, tracking, baseline, kerning, indents, space before/after)
 * that already lives in the floating toolbar (quick, next to the
 * selection) and in the Design panel (full, with scope + clamp notices)
 * — and it wrote them through a THIRD, divergent path
 * (DesignSettingsEngine.updateRoleStyle, role-only, ignoring the
 * selection) while being the only place that wrote an absolute
 * leadingPt, which then shadowed lineSpacingRatio in the resolver so
 * the floating toolbar's leading stepper silently stopped working
 * after a Control Panel leading edit. All text styling now goes
 * through the one shared handler in engine/text-style-apply.ts, called
 * from the floating toolbar and the Design panel. What stays here is
 * the one thing only this panel does: a selected custom-layout
 * frame's X/Y/width/height in pt measured from the Hebrew publishing
 * origin (the INSIDE / binding edge — see
 * workspace-layout.resolveMeasurementOrigin) + rotation angle.
 * Rotation is stored on the box (`rotationDeg`, new in v0.7.0) and
 * rendered as a CSS transform on the movable box overlay (Part 3
 * frame tools).
 *   v0.8.0 Part E — honest limit, now labelled in the UI too: rotation
 *   and skew turn ONLY the frame outline on screen. The text flow inside
 *   stays axis-aligned and no exporter reads them, so the controls say
 *   so instead of implying a rotated layout.
 *
 * Drop caps: the prompt asks for them here, but the pagination engine has
 * no drop-cap rendering at all (no field, no shaper support), so no
 * drop-cap control is shown — a dead control would be worse than the
 * honest gap (recorded in MANIFEST.md).
 */
import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { resolveMeasurementOrigin, frameGeometryPt } from '../engine/workspace-layout';
import type { CustomLayoutBox } from '../types/design-settings';

export interface SelectedFrameGeometry {
  box: CustomLayoutBox;
  /** Page width in pt, for the inside-origin X conversion. */
  pageWidthPt: number;
  /** Page height in pt — the actual page height of the active layout (720pt Vilna folio, 842pt A4), never a hardcoded 680pt (v0.8.0 Part C §5). */
  pageHeightPt: number;
  /** True when this is a right-facing (verso) page — the b-side of a Hebrew folio. */
  isVerso: boolean;
}

interface ControlPanelProps {
  frame: SelectedFrameGeometry | null;
  onFrameGeometryChange: (boxId: string, patch: Partial<CustomLayoutBox>) => void;
  onAutoCenterFrame: () => void;
}

function NumField(props: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  suffix?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-[var(--ui-muted)]" title={props.title}>
      <span>{props.label}</span>
      <span className="flex items-center gap-0.5">
        <input
          type="number"
          className="w-16 px-1 py-0.5 rounded border border-[var(--ui-border)] bg-[var(--ui-input-bg)] text-[var(--ui-text)] text-xs"
          value={Number.isFinite(props.value) ? Math.round(props.value * 100) / 100 : 0}
          step={props.step ?? 0.5}
          min={props.min}
          max={props.max}
          disabled={props.disabled}
          onChange={e => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) props.onChange(v);
          }}
        />
        {props.suffix && <span>{props.suffix}</span>}
      </span>
    </label>
  );
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  frame,
  onFrameGeometryChange,
  onAutoCenterFrame,
}) => {
  const { t, dir } = useLanguage();

  return (
    <div
      dir={dir}
      // v0.9.2 Part C: the panel keeps its selected-state height
      // (min-h) even with nothing selected. With a unit selected it
      // shows the full row of labelled controls (~70px); unselected it
      // is only the "לוח בקרה" label (~34px). If the bar grew in-flow,
      // the page canvas below would jump down ~36px on every word
      // click — and the second click of a double-click would land on
      // empty sheet where the word was, blurring the editor shut.
      // Reserving the height keeps the page still.
      className="shrink-0 flex items-end gap-3 px-3 py-1.5 border-b border-[var(--ui-border)] bg-[var(--ui-panel-bg)] overflow-x-auto min-h-[70px]"
      data-testid="control-panel"
    >
      <span className="text-[11px] font-semibold text-[var(--ui-muted)] whitespace-nowrap pb-1">
        {t('גאומטריית מסגרת')}
      </span>

      {frame ? (
        <>
          {(() => {
            // v0.8.0 Part C (§5): all four values come from the actual
            // page size via frameGeometryPt — no hardcoded 680pt.
            const geom = frameGeometryPt(frame.box, frame.pageWidthPt, frame.pageHeightPt);
            const origin = resolveMeasurementOrigin(
              geom.xPt,
              frame.pageWidthPt,
              frame.isVerso
            );
            return (
              <>
                <NumField
                  label={t('X (מהכריכה הפנימית)')}
                  value={origin.xFromOriginPt}
                  step={1}
                  min={0}
                  suffix="pt"
                  onChange={v => {
                    // v0.8.0 Part C (§4): the inside edge is the RIGHT edge
                    // on a recto (left-hand) page and the LEFT edge on a
                    // verso (right-hand) page — the flip is on recto.
                    const xFromLeft = frame.isVerso ? v : frame.pageWidthPt - v;
                    onFrameGeometryChange(frame.box.id, { xPct: (xFromLeft / frame.pageWidthPt) * 100 });
                  }}
                />
                <NumField label="Y" value={geom.yPt} step={1} min={0} suffix="pt"
                  onChange={v => onFrameGeometryChange(frame.box.id, { yPct: (v / frame.pageHeightPt) * 100 })} />
                <NumField label={t('רוחב')} value={geom.widthPt} step={1} min={10} suffix="pt"
                  onChange={v => onFrameGeometryChange(frame.box.id, { widthPct: (v / frame.pageWidthPt) * 100 })} />
                <NumField label={t('גובה')} value={geom.heightPt} step={1} min={10} suffix="pt"
                  onChange={v => onFrameGeometryChange(frame.box.id, { heightPct: (v / frame.pageHeightPt) * 100 })} />
                <NumField label={t('סיבוב')} value={frame.box.rotationDeg ?? 0} step={1} min={-180} max={180} suffix="°"
                  title={t('מסובב רק את קו המתאר של המסגרת על המסך — הטקסט נשאר ישר, והייצוא מתעלם מהסיבוב')}
                  onChange={v => onFrameGeometryChange(frame.box.id, { rotationDeg: v })} />
                <NumField label={t('הטיה')} value={frame.box.skewXDeg ?? 0} step={0.5} min={-30} max={30} suffix="°"
                  disabled
                  title={t('הטיית המסגרת (תצוגה בלבד — הטקסט נשאר ישר, והייצוא מתעלם מההטיה). ניתנת לשינוי בגרירת ידית ההטיה על הדף.')}
                  onChange={() => undefined} />
                {((frame.box.rotationDeg ?? 0) !== 0 || (frame.box.skewXDeg ?? 0) !== 0) && (
                  <span className="text-[10px] text-[var(--ui-warning)] whitespace-nowrap pb-1">
                    {t('סיבוב/הטיה: רק קו המתאר על המסך — הטקסט אינו מוטה ואינו מיוצא מוטה')}
                  </span>
                )}
                <button
                  type="button"
                  className="mb-0.5 px-2 py-1 rounded border border-[var(--ui-border)] text-xs hover:bg-[var(--ui-hover)] whitespace-nowrap"
                  onClick={onAutoCenterFrame}
                  title="Ctrl+Alt+Shift+C"
                >
                  {t('מרכוז אוטומטי')}
                </button>
              </>
            );
          })()}
        </>
      ) : (
        <span className="text-[11px] text-[var(--ui-muted)] pb-1">{t('בחרו מסגרת כדי לערוך את הגאומטריה שלה — גופן וגודל נערכים בסרגל הצף או בחלונית העיצוב')}</span>
      )}
    </div>
  );
};
