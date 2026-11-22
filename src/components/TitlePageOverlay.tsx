/**
 * Title Page (Shaar Blat) preview overlay — v0.5.0 (Title Page builder),
 * v0.9.9 template rendering.
 *
 * Renders the title page inside PageCanvas: the stock border (or the
 * user-imported frame image) plus the editable fields, laid out by the
 * shared `layoutTitlePageFields` helper — the same heights the PDF and
 * IDML renderers use. Empty fields show as faint placeholders ("click to
 * add"); clicking any field edits it in place (contenteditable) and the
 * commit goes to the parent via `onFieldChange` (the same undo path as
 * every other design-settings change).
 *
 * Field text is set via innerHTML once per edit session (the Module 8
 * pattern) so typing never fights React's reconciliation or jumps the
 * caret. Keys are plain field ids, or `extra:<index>` for extra lines,
 * or `meta:<key>` for template metadata fields (see below).
 *
 * v0.9.9 — template rendering: when a template is active on the settings
 * (`title-page-templates.ts`), the overlay draws the template's own frame
 * (which may be a template-only border id the PDF renders as its closest
 * fallback — see that file's header), its background style, its ornaments
 * (original Keter vector SVG from `ornament-library.ts`) and its metadata
 * rows (English title, editor, dedication, …) in their template zones.
 * Metadata rows are editable in place like the standard fields; their
 * commits go out as `meta:<key>` — `App.handleTitlePageFieldChange` must
 * accept those (coordinator wiring; today App drops unknown ids). Metadata
 * rows are NOT draggable: the position handler in App knows only the
 * standard fields and `extra:<n>`. Template-only typography (italic,
 * all-caps, small-caps, letter-spacing) is applied here with CSS; the PDF
 * has no such flag on its title-page rows yet and renders those fields
 * upright / mixed case — the one deliberate preview/PDF difference, listed
 * in `title-page-templates.ts`.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  borderCommandsToSvg,
  buildTitlePageBorderCommands,
  getLoadedBorderImage,
  layoutTitlePageFields,
  resolveTitlePageBorder,
  titlePageBorderImageRect,
  type TitlePageFieldRow,
} from '../engine/title-page-borders';
import {
  effectiveTitlePageBackground,
  effectiveTitlePageBorderStyleId,
  layoutTemplateMetadataRows,
  readTitlePageTemplateState,
  resolveTemplateOrnaments,
  resolveTitlePageTemplate,
  TITLE_PAGE_METADATA_LABELS_HE,
  type TitlePageMetadataRow,
} from '../engine/title-page-templates';
import { OrnamentLibraryEngine } from '../engine/ornament-library';
import type { TitlePageSettings } from '../types/design-settings';
import { useLanguage } from '../i18n/LanguageContext';

interface TitlePageOverlayProps {
  titlePage: TitlePageSettings;
  bookTitle: string;
  pageWidthPt: number;
  pageHeightPt: number;
  scale: number;
  marginInPx: number;
  marginOutPx: number;
  fontFamilyDefault: string;
  onFieldChange?: (fieldId: string, text: string) => void;
  /** v0.6.0 Part C (§8): drag a field to a new position on the page. */
  onFieldPositionChange?: (fieldId: string, xOffsetPt: number, yOffsetPt: number) => void;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FIELD_LABELS: Record<string, string> = {
  title: 'שם הספר',
  subtitle: 'כותרת משנה',
  author: 'מחבר',
  translator: 'מתרגם',
  volume: 'כרך',
  year: 'שנה',
  publisher: 'מוציא לאור',
};

function fieldKey(row: TitlePageFieldRow): string {
  return row.fieldId === 'extra' ? `extra:${row.extraIndex ?? 0}` : row.fieldId;
}

export const TitlePageOverlay: React.FC<TitlePageOverlayProps> = ({
  titlePage,
  bookTitle,
  pageWidthPt,
  pageHeightPt,
  scale,
  marginInPx,
  marginOutPx,
  fontFamilyDefault,
  onFieldChange,
  onFieldPositionChange,
}) => {
  const { tf } = useLanguage();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // v0.6.0 Part C (§8): drag state for a title-page field. A press that
  // moves < 4px is a click (opens the editor); further movement drags
  // the field and commits its new offset on release.
  const [dragState, setDragState] = useState<{
    key: string;
    startClientX: number;
    startClientY: number;
    origXOffsetPt: number;
    origYOffsetPt: number;
    dxPt: number;
    dyPt: number;
    moved: boolean;
  } | null>(null);
  const dragRef = useRef<typeof dragState>(null);
  dragRef.current = dragState;

  // v0.9.9: the active template (null = legacy/classic default rendering).
  const template = resolveTitlePageTemplate(titlePage);
  const { metadata } = readTitlePageTemplateState(titlePage);
  const templateTitleBoldItalic =
    template?.id === 'thin_double_minimal' && metadata.titleStyle === 'boldItalic';

  const fieldOffsets = (key: string): { x: number; y: number } => {
    const find = (f: { xOffsetPt?: number; yOffsetPt?: number } | undefined) => ({
      x: f?.xOffsetPt ?? 0,
      y: f?.yOffsetPt ?? 0,
    });
    if (key.startsWith('extra:')) {
      const idx = Number(key.slice('extra:'.length));
      return find(titlePage.extraLines[idx]);
    }
    const field = (titlePage as unknown as Record<string, { xOffsetPt?: number; yOffsetPt?: number }>)[key];
    return find(field);
  };

  const onFieldPointerDown = (e: React.PointerEvent, key: string) => {
    if (editingKey) return;
    const off = fieldOffsets(key);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const st = {
      key,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origXOffsetPt: off.x,
      origYOffsetPt: off.y,
      dxPt: 0,
      dyPt: 0,
      moved: false,
    };
    dragRef.current = st;
    setDragState(st);
  };

  const onFieldPointerMove = (e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st) return;
    const dxPt = (e.clientX - st.startClientX) / Math.max(0.01, scale);
    const dyPt = (e.clientY - st.startClientY) / Math.max(0.01, scale);
    const moved = st.moved || Math.hypot(e.clientX - st.startClientX, e.clientY - st.startClientY) > 4;
    const next = { ...st, dxPt, dyPt, moved };
    dragRef.current = next;
    setDragState(next);
  };

  const onFieldPointerUp = () => {
    const st = dragRef.current;
    dragRef.current = null;
    setDragState(null);
    if (!st) return;
    if (st.moved && onFieldPositionChange) {
      onFieldPositionChange(
        st.key,
        Math.round((st.origXOffsetPt + st.dxPt) * 10) / 10,
        Math.round((st.origYOffsetPt + st.dyPt) * 10) / 10
      );
    } else if (!st.moved) {
      setEditingKey(st.key);
    }
  };

  // Warm the loaded-image cache for the canvas (raster-fallback) renderer:
  // the preview <img> below loads the same data URL, but the exporter's
  // cache is a separate Image object.
  useEffect(() => {
    const img = titlePage.customBorderImage?.dataUrl;
    if (img) getLoadedBorderImage(img);
  }, [titlePage.customBorderImage?.dataUrl]);

  const rows = layoutTitlePageFields(titlePage, bookTitle, pageHeightPt);

  // Where would all empty fields sit if filled together? Fill every empty
  // field with its placeholder label in one copy so multiple empty fields
  // stack cleanly in sequence instead of stacking onto the same baseline.
  const allFilled: TitlePageSettings = JSON.parse(JSON.stringify(titlePage));
  for (const key of Object.keys(FIELD_LABELS)) {
    if (key === 'title' && (bookTitle ?? '').trim()) continue;
    const field = (allFilled as unknown as Record<string, { text?: string }>)[key];
    if (field && typeof field === 'object' && !(field.text ?? '').trim()) {
      field.text = FIELD_LABELS[key] ?? key;
    }
  }
  allFilled.extraLines = allFilled.extraLines.map(line =>
    (line.text ?? '').trim() ? line : { ...line, text: 'שורה נוספת' }
  );
  const allFilledRows = layoutTitlePageFields(allFilled, bookTitle, pageHeightPt);

  const placeholders: Array<{ key: string; row: TitlePageFieldRow; label: string }> = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const hasRow = rows.some(r => fieldKey(r) === key);
    if (hasRow) continue;
    if (key === 'title' && (bookTitle ?? '').trim()) continue;
    const row = allFilledRows.find(r => r.fieldId === key) ?? null;
    if (row) placeholders.push({ key, row, label: FIELD_LABELS[key] });
  }
  titlePage.extraLines.forEach((line, i) => {
    if ((line.text ?? '').trim()) return;
    const key = `extra:${i}`;
    const row = allFilledRows.find(r => r.fieldId === 'extra' && r.extraIndex === i) ?? null;
    if (row) placeholders.push({ key, row, label: 'שורה נוספת' });
  });

  // v0.9.9: template metadata rows (filled) + placeholders for the
  // template's primary metadata fields when empty. They sit in zones that
  // never shift the shared standard-field stack, so the standard fields
  // keep the exact heights the PDF renders.
  const metadataRows: TitlePageMetadataRow[] = template
    ? layoutTemplateMetadataRows(titlePage, template, rows, pageHeightPt)
    : [];
  const metadataPlaceholders: Array<{ key: string; row: TitlePageMetadataRow; label: string }> = [];
  if (template) {
    const filledMeta: TitlePageSettings = JSON.parse(JSON.stringify(titlePage));
    const metaBag: Record<string, string> = {
      ...(readTitlePageTemplateState(filledMeta).metadata as unknown as Record<string, string>),
    };
    for (const key of template.primaryMetadata) {
      if (!(metaBag[key] ?? '').trim()) metaBag[key] = TITLE_PAGE_METADATA_LABELS_HE[key];
    }
    const allFilledMetaRows = layoutTemplateMetadataRows(
      { ...filledMeta, templateMetadata: metaBag } as unknown as TitlePageSettings,
      template,
      allFilledRows,
      pageHeightPt
    );
    for (const key of template.primaryMetadata) {
      if ((metadata[key] ?? '').trim()) continue;
      const row = allFilledMetaRows.find(r => r.key === key) ?? null;
      if (row) metadataPlaceholders.push({ key: `meta:${key}`, row, label: TITLE_PAGE_METADATA_LABELS_HE[key] });
    }
  }

  useEffect(() => {
    if (!editingKey) return;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-title-field="${editingKey}"]`
    );
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editingKey]);

  const border = resolveTitlePageBorder(titlePage);
  // v0.9.9: a template's own frame wins over the stored stock frame; the
  // stored frame is the PDF fallback (see title-page-templates.ts). The
  // border toggle still gates it, and a custom imported image still
  // replaces any stock frame.
  const effectiveBorderId = effectiveTitlePageBorderStyleId(titlePage);
  const borderSvg =
    border.kind === 'stock' && titlePage.border.enabled && effectiveBorderId !== 'none'
      ? borderCommandsToSvg(
          buildTitlePageBorderCommands(
            effectiveBorderId,
            titlePage.border.insetMm,
            titlePage.border.thicknessPt,
            pageWidthPt,
            pageHeightPt,
            {
              scalePct: titlePage.border.scalePct,
              paddingMm: titlePage.border.paddingMm,
              offsetXMm: titlePage.border.offsetXMm,
              offsetYMm: titlePage.border.offsetYMm,
            }
          ),
          '#2A2622',
          Math.max(1.5, (titlePage.border.thicknessPt * 1000) / pageHeightPt)
        )
      : '';
  const borderImageRect =
    border.kind === 'image'
      ? titlePageBorderImageRect(
          {
            enabled: true,
            styleId: 'double',
            thicknessPt: 1,
            insetMm: 12,
            scalePct: titlePage.border.scalePct,
            paddingMm: titlePage.border.paddingMm,
            offsetXMm: titlePage.border.offsetXMm,
            offsetYMm: titlePage.border.offsetYMm,
          },
          pageWidthPt,
          pageHeightPt
        )
      : null;

  // v0.9.9: template background + ornaments.
  const backgroundKind = effectiveTitlePageBackground(titlePage);
  const ornaments = template ? resolveTemplateOrnaments(titlePage, template) : [];
  const titleRow = rows.find(r => r.fieldId === 'title');
  const publisherRow = rows.find(r => r.fieldId === 'publisher');

  const renderField = (
    key: string,
    row: TitlePageFieldRow,
    displayText: string,
    isPlaceholder: boolean,
    opts?: {
      draggable?: boolean;
      italic?: boolean;
      uppercase?: boolean;
      smallCaps?: boolean;
      letterSpacingPt?: number;
    }
  ) => {
    const isEditing = editingKey === key;
    const draggable = opts?.draggable ?? true;
    const drag = draggable && dragState?.key === key ? dragState : null;
    const topPx = Math.max(0, (row.yBaselinePt - row.fontSizePt) * scale + (drag ? drag.dyPt * scale : 0));
    const xShiftPx = (row.xOffsetPt + (drag ? drag.dxPt : 0)) * scale;
    return (
      <div
        key={`${key}:${isEditing ? 'edit' : 'view'}`}
        data-title-field={key}
        dir="auto"
        contentEditable={isEditing}
        suppressContentEditableWarning
        onPointerDown={e => {
          if (!isEditing && draggable) onFieldPointerDown(e, key);
        }}
        onPointerMove={onFieldPointerMove}
        onPointerUp={onFieldPointerUp}
        onClick={e => {
          e.stopPropagation();
          if (!draggable && !isEditing) setEditingKey(key);
        }}
        onBlur={e => {
          if (!isEditing) return;
          const text = (e.currentTarget.textContent ?? '').trim();
          setEditingKey(null);
          onFieldChange?.(key, text);
        }}
        onKeyDown={e => {
          // Keep the app's global shortcuts (undo, etc.) out of the field:
          // the browser's own editing keys apply while typing here.
          e.stopPropagation();
          if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
        }}
        dangerouslySetInnerHTML={{ __html: esc(isEditing && isPlaceholder ? '' : displayText) }}
        className={`absolute cursor-text rounded px-1 ${
          isEditing
            ? 'outline-2 outline outline-[var(--ui-accent)] bg-white/60'
            : drag?.moved
              ? 'outline-2 outline outline-[var(--ui-accent)] bg-white/40 cursor-grabbing'
              : 'hover:outline hover:outline-1 hover:outline-dashed hover:outline-[#b0a58e] cursor-grab'
        } ${isPlaceholder && !isEditing ? 'italic border border-dashed border-[#c9c2b4] text-[#9a8f7d]' : ''}`}
        style={{
          top: `${topPx}px`,
          left: `${marginOutPx + xShiftPx}px`,
          right: `${marginInPx - xShiftPx}px`,
          textAlign: row.alignment,
          fontSize: `${row.fontSizePt * scale}px`,
          lineHeight: row.lineHeight,
          fontFamily: row.fontFamily
            ? `"${row.fontFamily}", "Frank Ruhl Libre", serif`
            : `"${fontFamilyDefault}", "Frank Ruhl Libre", serif`,
          color: isPlaceholder && !isEditing ? undefined : row.colorHex,
          fontWeight: row.isBold ? 700 : 400,
          fontStyle: opts?.italic ? 'italic' : 'normal',
          textTransform: opts?.uppercase ? 'uppercase' : 'none',
          fontVariant: opts?.smallCaps ? 'small-caps' : 'normal',
          letterSpacing: opts?.letterSpacingPt ? `${opts.letterSpacingPt * scale}px` : undefined,
          minHeight: `${row.fontSizePt * scale * row.lineHeight}px`,
        }}
      />
    );
  };

  /** Template typography for a standard field (preview-only extras: italic
   *  / uppercase / small-caps / letter-spacing — see the header note). */
  const templateFieldOpts = (fieldId: string) => {
    if (!template) return undefined;
    const style = template.fieldStyles[fieldId as keyof typeof template.fieldStyles];
    if (!style && fieldId !== 'title') return undefined;
    const italic = fieldId === 'title' && templateTitleBoldItalic
      ? true
      : style?.italic ?? false;
    return {
      italic,
      uppercase: style?.uppercase ?? false,
      smallCaps: style?.smallCaps ?? false,
      letterSpacingPt: style?.letterSpacingPt,
    };
  };

  const metadataRowToFieldRow = (mrow: TitlePageMetadataRow): TitlePageFieldRow => ({
    fieldId: 'extra',
    text: mrow.text,
    fontFamily: mrow.fontFamily,
    fontSizePt: mrow.fontSizePt,
    isBold: mrow.isBold,
    alignment: mrow.alignment,
    spaceAbovePt: 0,
    spaceBelowPt: 0,
    lineHeight: mrow.lineHeight,
    xOffsetPt: 0,
    yOffsetPt: 0,
    yBaselinePt: mrow.yBaselinePt,
    colorHex: mrow.colorHex,
  });

  const renderOrnament = (orn: { ornamentId: string; position: string; widthPt: number }) => {
    const vb = OrnamentLibraryEngine.TITLE_PAGE_ORNAMENT_VIEWBOX[orn.ornamentId];
    if (!vb) return null;
    const wPx = orn.widthPt * scale;
    const hPx = (wPx * vb.h) / vb.w;
    let topPt: number;
    if (orn.position === 'topCenter') {
      topPt = pageHeightPt * 0.055;
    } else if (orn.position === 'belowTitle') {
      topPt = titleRow ? titleRow.yBaselinePt + 10 : pageHeightPt * 0.4;
    } else if (orn.position === 'abovePublisher') {
      topPt = publisherRow ? publisherRow.yBaselinePt - 46 : pageHeightPt * 0.78;
    } else {
      // footCenter: centred above the pinned publisher line.
      topPt = pageHeightPt * 0.79;
    }
    return (
      <svg
        key={orn.ornamentId + orn.position}
        viewBox={`0 0 ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: 'absolute',
          left: `calc(50% - ${wPx / 2}px)`,
          top: `${topPt * scale}px`,
          width: `${wPx}px`,
          height: `${hPx}px`,
          pointerEvents: 'none',
        }}
        dangerouslySetInnerHTML={{
          __html: OrnamentLibraryEngine.titlePageOrnamentSvgMarkup(orn.ornamentId, '#2A2622'),
        }}
      />
    );
  };

  return (
    <div ref={containerRef} className="absolute inset-0" style={{ zIndex: 5 }}>
      {/* v0.9.9: template background (preview only — the PDF fills solid). */}
      {backgroundKind === 'warm' && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: '#F7F0DF' }} />
      )}
      {backgroundKind === 'textured' && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundColor: '#FCFAF5',
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(120, 100, 60, 0.05) 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, rgba(120, 100, 60, 0.04) 0 1px, transparent 1px 5px)',
          }}
        />
      )}
      {border.kind === 'image' && borderImageRect ? (
        <img
          src={border.image.dataUrl}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: `${borderImageRect.x * scale}px`,
            top: `${borderImageRect.y * scale}px`,
            width: `${borderImageRect.w * scale}px`,
            height: `${borderImageRect.h * scale}px`,
            objectFit: 'fill',
          }}
        />
      ) : borderSvg ? (
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          dangerouslySetInnerHTML={{ __html: borderSvg }}
        />
      ) : null}
      {ornaments.map(renderOrnament)}
      {rows.map(row => renderField(fieldKey(row), row, row.text, false, templateFieldOpts(row.fieldId)))}
      {placeholders.map(p => renderField(p.key, p.row, p.label, true, templateFieldOpts(p.key)))}
      {metadataRows.map(mrow => {
        const key = `meta:${mrow.key}`;
        const fieldRow = metadataRowToFieldRow(mrow);
        return (
          <React.Fragment key={key}>
            {renderField(key, fieldRow, mrow.text, false, {
              draggable: false,
              italic: mrow.italic,
              uppercase: mrow.uppercase,
              smallCaps: mrow.smallCaps,
            })}
            {mrow.ruleBelow && (
              <div
                className="absolute pointer-events-none"
                style={{
                  top: `${(mrow.yBaselinePt + 8) * scale}px`,
                  left: '50%',
                  width: `${72 * scale}px`,
                  marginLeft: `${-36 * scale}px`,
                  borderTop: '1px solid #2A2622',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
      {metadataPlaceholders.map(p => {
        const fieldRow = metadataRowToFieldRow(p.row);
        return (
          <React.Fragment key={p.key}>
            {renderField(p.key, fieldRow, p.label, true, {
              draggable: false,
              italic: p.row.italic,
              uppercase: p.row.uppercase,
              smallCaps: p.row.smallCaps,
            })}
            {p.row.ruleBelow && (
              <div
                className="absolute pointer-events-none"
                style={{
                  top: `${(p.row.yBaselinePt + 8) * scale}px`,
                  left: '50%',
                  width: `${72 * scale}px`,
                  marginLeft: `${-36 * scale}px`,
                  borderTop: '1px solid #c9c2b4',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
      {titlePage.coverMode === 'print_wraparound_cover' && titlePage.wraparoundCover && (
        <div
          data-testid="wraparound-cover-indicator"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded bg-[#FAF5EA]/90 border border-[#C6B79B] text-[10px] font-medium text-[#5A4D3B] pointer-events-none whitespace-nowrap"
        >
          {tf('כריכה מלאה לדפוס · שדרה {spine} מ״מ · בליד {bleed} מ״מ', {
            spine: String(titlePage.wraparoundCover.spineWidthMm),
            bleed: String(titlePage.wraparoundCover.bleedMm),
          })}
        </div>
      )}
    </div>
  );
};
