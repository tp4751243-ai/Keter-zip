/**
 * Title Page (Shaar Blat) editor panel — v0.5.0 (Title Page builder).
 *
 * Lives in the Design panel as the "עמוד שער" tab. Essentials up front
 * (the text fields), per-field font/size/alignment/spacing behind a small
 * "אפשרויות טקסט" disclosure per field, and the border picker with live
 * SVG previews. Every change goes through `onUpdateDesignSettings`, so it
 * is undoable and saved with the project — the same path as every other
 * design setting. The fields are also editable directly on the title page
 * itself (PageCanvas overlay); this panel is the form view of the same data.
 */

import React, { useRef, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { Hint } from './Hint';
import { FontDropdown } from './FontDropdown';
import { TitlePageBorderPreview } from './TitlePageBorderPreview';
import {
  TITLE_PAGE_BORDER_STYLES,
  TITLE_PAGE_MAX_EXTRA_LINES,
  prepareBorderImageFile,
} from '../engine/title-page-borders';
import { BUILTIN_ORNAMENTS } from '../engine/ornament-library';
import {
  applyTitlePageTemplate,
  clearTitlePageTemplate,
  readTitlePageTemplateState,
  resolveTitlePageTemplate,
  TITLE_PAGE_METADATA_LABELS_HE,
  TITLE_PAGE_METADATA_PLACEHOLDERS_HE,
  TITLE_PAGE_TEMPLATES,
  type TitlePageMetadataKey,
  type TitlePageTemplateId,
} from '../engine/title-page-templates';
import type { LocalFontEntry } from '../types/typesetter';
import type {
  ProfessionalDesignSettings,
  TitlePageFieldStyle,
  TitlePageSettings,
} from '../types/design-settings';

interface TitlePagePanelProps {
  designSettings: ProfessionalDesignSettings;
  onUpdateDesignSettings: (next: ProfessionalDesignSettings, summaryHe?: string) => void;
  bookTitle: string;
  availableFonts: LocalFontEntry[];
}

type FieldId = 'title' | 'subtitle' | 'author' | 'translator' | 'publisher' | 'volume' | 'year';

const FIELD_DEFS: Array<{ id: FieldId; labelHe: string; placeholderHe: string }> = [
  { id: 'title', labelHe: 'שם הספר', placeholderHe: 'למשל: ספר תהלים' },
  { id: 'subtitle', labelHe: 'כותרת משנה', placeholderHe: 'למשל: עם פירוש רש״י' },
  { id: 'author', labelHe: 'מחבר', placeholderHe: 'למשל: רבי שלמה יצחקי' },
  { id: 'translator', labelHe: 'מתרגם', placeholderHe: 'למשל: הרב אליהו טוגר' },
  { id: 'volume', labelHe: 'כרך', placeholderHe: 'למשל: כרך א׳' },
  { id: 'year', labelHe: 'שנה', placeholderHe: 'למשל: תשפ״ז · 2026' },
  { id: 'publisher', labelHe: 'מוציא לאור', placeholderHe: 'למשל: הוצאת כתר' },
];

const inputCls =
  'w-full bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--ui-text-primary)]';
const labelCls = 'block text-[11px] font-semibold text-[var(--ui-text-primary)] mb-1';

export const TitlePagePanel: React.FC<TitlePagePanelProps> = ({
  designSettings,
  onUpdateDesignSettings,
  bookTitle,
  availableFonts,
}) => {
  const { t, lang } = useLanguage();
  const tp: TitlePageSettings = designSettings.titlePage;
  const [openFieldOptions, setOpenFieldOptions] = useState<FieldId | null>(null);
  const [openExtraOptions, setOpenExtraOptions] = useState<number | null>(null);
  const [showMetadata, setShowMetadata] = useState<boolean>(false);
  const [importNote, setImportNote] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // v0.9.9: the active title-page template (null = legacy/classic default)
  // and its extra metadata bag.
  const activeTemplate = resolveTitlePageTemplate(tp);
  const activeTemplateId = activeTemplate?.id ?? null;
  const { metadata: templateMetadata } = readTitlePageTemplateState(tp);
  const visibleMetadataKeys: TitlePageMetadataKey[] = activeTemplate
    ? activeTemplate.metadataOrder.map(s => s.key)
    : (['titleEn', 'subtitleEn', 'editor', 'dedication', 'openingFormula', 'seriesLabel', 'description', 'publisherLocation', 'publisherWebsite', 'hebrewDate', 'sourceCredit'] as TitlePageMetadataKey[]);
  const titlePageOrnaments = BUILTIN_ORNAMENTS.filter(a => a.id.startsWith('orn-tp-'));

  const update = (mutate: (next: TitlePageSettings) => void, summaryHe: string) => {
    const cloned: TitlePageSettings = JSON.parse(JSON.stringify(tp));
    mutate(cloned);
    onUpdateDesignSettings({ ...designSettings, titlePage: cloned }, summaryHe);
  };

  const updateField = (id: FieldId, patch: Partial<TitlePageFieldStyle>, summaryHe: string) => {
    update(next => {
      next[id] = { ...next[id], ...patch };
    }, summaryHe);
  };

  // v0.9.9: apply / clear a title-page template. Applying changes the
  // frame and the per-field sizes/spacing/alignment only — all text is
  // preserved. Clearing restores the classic double frame.
  const applyTemplate = (id: TitlePageTemplateId | null) => {
    const cloned: TitlePageSettings = JSON.parse(JSON.stringify(tp));
    const next = id ? applyTitlePageTemplate(cloned, id) : clearTitlePageTemplate(cloned);
    onUpdateDesignSettings(
      { ...designSettings, titlePage: next },
      id ? 'תבנית עמוד השער הוחלה' : 'תבנית עמוד השער בוטלה'
    );
  };

  // v0.9.9: write one key of the template metadata bag (English title,
  // editor, dedication, publisher location/website, Hebrew date, …).
  // An empty value deletes the key, so blank fields stay blank and are
  // never printed. Goes through the same undo path as every other change.
  const updateMetadata = (
    key: TitlePageMetadataKey | 'titleStyle' | 'backgroundOverride' | 'emblemId',
    value: string | undefined
  ) => {
    update(next => {
      const target = next as unknown as Record<string, unknown>;
      const bag: Record<string, unknown> = {
        ...(readTitlePageTemplateState(next).metadata as unknown as Record<string, unknown>),
      };
      if (value === undefined || (typeof value === 'string' && !value.trim())) {
        delete bag[key];
      } else {
        bag[key] = value;
      }
      if (Object.keys(bag).length > 0) {
        target.templateMetadata = bag;
      } else {
        delete target.templateMetadata;
      }
    }, 'פרטי עמוד השער עודכנו');
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setIsImporting(true);
    setImportNote('');
    try {
      const prepared = await prepareBorderImageFile(file);
      update(
        next => {
          next.customBorderImage = {
            fileName: prepared.fileName,
            dataUrl: prepared.dataUrl,
            persisted: prepared.persisted,
          };
        },
        'ייבוא מסגרת מותאמת לעמוד השער'
      );
      if (prepared.noteHe) setImportNote(t(prepared.noteHe));
    } catch {
      setImportNote(t('התמונה גדולה מדי לשמירה בקובץ הפרויקט — היא תישמר רק להפעלה הנוכחית.'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Hint>
        {t('עמוד השער מופיע כעמוד הראשון של הספר, לפני הטקסט. אפשר לערוך אותו כאן או ישירות על העמוד.')}
      </Hint>

      {/* Enable toggle */}
      <label className="flex items-center gap-2 text-xs text-[var(--ui-text-primary)] cursor-pointer">
        <input
          type="checkbox"
          data-testid="title-page-enabled-toggle"
          checked={tp.enabled}
          onChange={e =>
            update(next => { next.enabled = e.target.checked; }, e.target.checked ? 'עמוד שער נוסף כעמוד הראשון של הספר.' : 'עמוד השער הוסר.')
          }
          className="w-4 h-4 accent-[var(--ui-accent)]"
        />
        <span className="font-semibold">{t('הצג עמוד שער')}</span>
      </label>

      {!tp.enabled ? null : (
        <>
          {/* v0.9.9: title-page template picker (8 presets). Applying a
              template changes only the frame and the per-field typography;
              all text is preserved. Picking a stock frame below clears the
              template. Templates style the INTERIOR title page only. */}
          <div className="space-y-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2.5">
            <label className={labelCls}>{t('תבנית עמוד שער')}</label>
            <p className="text-[10px] text-[var(--ui-text-secondary)]">
              {t('בחרו תבנית לעמוד השער — הטקסט נשמר, רק המסגרת והטיפוגרפיה משתנות.')}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {TITLE_PAGE_TEMPLATES.map(tpl => {
                const isActive = activeTemplateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    data-testid={`title-page-template-${tpl.id}`}
                    onClick={() => applyTemplate(tpl.id)}
                    className={`py-1.5 px-2 rounded-md border text-start transition-colors ${
                      isActive
                        ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)] font-semibold'
                        : 'border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-secondary)]'
                    }`}
                    aria-pressed={isActive}
                  >
                    <span className="block text-[11px] font-medium leading-tight text-[var(--ui-text-primary)]">
                      {lang === 'en' ? tpl.nameEn : tpl.nameHe}
                    </span>
                    <span className="block mt-0.5 text-[10px] leading-tight">
                      {lang === 'en' ? tpl.bestForEn : tpl.bestForHe}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              data-testid="title-page-template-clear"
              onClick={() => applyTemplate(null)}
              className={`w-full py-1.5 px-2 rounded-md border text-[11px] font-medium transition-colors ${
                activeTemplateId === null
                  ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)] font-semibold'
                  : 'border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-secondary)]'
              }`}
              aria-pressed={activeTemplateId === null}
            >
              {t('ברירת מחדל קלאסית (בלי תבנית)')}
            </button>
            {activeTemplate && (
              <p className="text-[10px] text-[var(--ui-text-secondary)]">
                {lang === 'en' ? activeTemplate.descriptionEn : activeTemplate.descriptionHe}
              </p>
            )}
            {activeTemplate?.cautionHe && (
              <p className="text-[10px] text-[var(--ui-warning)]">
                {lang === 'en' ? activeTemplate.cautionEn : activeTemplate.cautionHe}
              </p>
            )}
            {activeTemplate && (
              <p className="text-[10px] text-[var(--ui-text-secondary)]">
                {t('התבנית מגדירה את מסגרת השער. בחירת מסגרת אחרת למטה מבטלת את התבנית.')}
              </p>
            )}
            <p className="text-[10px] text-[var(--ui-text-secondary)]">
              {t('שער פנימי בלבד — התבניות מעצבות את עמוד השער הפנימי. כריכה מלאה לדפוס דורשת מפרט דפוס (שדרה, בליד, גב) ואינה כריכה מוכנה לדפוס.')}
            </p>
          </div>

          {/* Cover mode selector: interior Sha'ar Blat vs wraparound cover */}
          <div className="space-y-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2.5">
            <label className={labelCls}>{t('סוג השער / כריכה')}</label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-testid="cover-mode-interior"
                onClick={() =>
                  update(next => {
                    next.coverMode = 'interior_title_page';
                  }, 'שער פנימי (שער בלאט)')
                }
                className={`py-1.5 px-2 rounded-md border text-[11px] font-medium transition-colors ${
                  (tp.coverMode ?? 'interior_title_page') === 'interior_title_page'
                    ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)] font-semibold'
                    : 'border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-secondary)]'
                }`}
              >
                {t('עמוד שער פנימי')}
              </button>
              <button
                type="button"
                data-testid="cover-mode-wraparound"
                onClick={() =>
                  update(next => {
                    next.coverMode = 'print_wraparound_cover';
                    if (!next.wraparoundCover) {
                      next.wraparoundCover = {
                        spineWidthMm: 14,
                        bleedMm: 3,
                        backCoverText: '',
                        backCoverSubtitle: '',
                        spineText: '',
                      };
                    }
                  }, 'כריכה מלאה לדפוס (חזית + שדרה + גב)')
                }
                className={`py-1.5 px-2 rounded-md border text-[11px] font-medium transition-colors ${
                  tp.coverMode === 'print_wraparound_cover'
                    ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)] font-semibold'
                    : 'border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-secondary)]'
                }`}
              >
                {t('כריכה מלאה לדפוס')}
              </button>
            </div>

            {tp.coverMode === 'print_wraparound_cover' && (() => {
              const wc = tp.wraparoundCover ?? {
                spineWidthMm: 14,
                bleedMm: 3,
                backCoverText: '',
                backCoverSubtitle: '',
                spineText: '',
              };
              const updateWc = (patch: Partial<typeof wc>, summaryHe: string) =>
                update(next => {
                  next.wraparoundCover = { ...wc, ...patch };
                }, summaryHe);
              return (
                <div className="space-y-2 pt-2 border-t border-[var(--ui-border)]">
                  {/* Layout training T3.5 — spine = leaves × paper thickness. */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>{t('עובי נייר לדף (מ״מ, מבית הדפוס)')}</label>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.005}
                        data-testid="wraparound-caliper"
                        value={wc.caliperMm ?? ''}
                        placeholder="0.1"
                        onChange={e => {
                          const v = Number(e.target.value);
                          updateWc({ caliperMm: v > 0 && v <= 1 ? v : undefined }, 'עובי הנייר עודכן');
                        }}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t('כפולת גיליון (4/8/16)')}</label>
                      <input
                        type="number"
                        min={2}
                        max={64}
                        step={2}
                        data-testid="wraparound-signature"
                        value={wc.signatureMultiple ?? ''}
                        placeholder="2"
                        onChange={e => {
                          const v = Math.round(Number(e.target.value));
                          updateWc({ signatureMultiple: v >= 2 ? v : undefined }, 'כפולת הגיליון עודכנה');
                        }}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <Hint>{t('כשמזינים עובי נייר, השדרה מחושבת לבד: מספר הדפים (עמודים ÷ 2) × עובי הנייר. העובי מגיע מבית הדפוס — לא לנחש. בכריכה עברית החזית היא הלוח השמאלי: [חזית] [שדרה] [גב].')}</Hint>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>{t('רוחב שדרה (מ״מ)')}</label>
                      <input
                        type="number"
                        min={2}
                        max={60}
                        step={0.5}
                        data-testid="wraparound-spine-width"
                        value={wc.spineWidthMm}
                        onChange={e =>
                          updateWc(
                            { spineWidthMm: Math.max(2, Math.min(60, Number(e.target.value) || 14)) },
                            'רוחב שדרת הכריכה עודכן'
                          )
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t('בליד כריכה (מ״מ)')}</label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.5}
                        data-testid="wraparound-bleed"
                        value={wc.bleedMm}
                        onChange={e =>
                          updateWc(
                            { bleedMm: Math.max(0, Math.min(10, Number(e.target.value) || 0)) },
                            'בליד הכריכה עודכן'
                          )
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>{t('טקסט לשדרה')}</label>
                    <input
                      type="text"
                      value={wc.spineText ?? ''}
                      placeholder={bookTitle || t('שם הספר על השדרה')}
                      onChange={e => updateWc({ spineText: e.target.value }, 'טקסט שדרת הכריכה עודכן')}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{t('כותרת גב הכריכה')}</label>
                    <input
                      type="text"
                      value={wc.backCoverSubtitle}
                      placeholder={t('תיאור קצר בגב הכריכה')}
                      onChange={e => updateWc({ backCoverSubtitle: e.target.value }, 'כותרת גב הכריכה עודכנה')}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>{t('טקסט גב הכריכה')}</label>
                    <textarea
                      rows={2}
                      value={wc.backCoverText}
                      placeholder={t('דברי פתיחה או ביוגרפיה לגב הכריכה...')}
                      onChange={e => updateWc({ backCoverText: e.target.value }, 'טקסט גב הכריכה עודכן')}
                      className={inputCls}
                    />
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Text fields */}
          <div className="space-y-3">
            {FIELD_DEFS.map(def => {
              const field = tp[def.id];
              const isOpen = openFieldOptions === def.id;
              return (
                <div key={def.id} className="space-y-1.5">
                  <label className={labelCls}>{t(def.labelHe)}</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={field.text}
                      placeholder={def.id === 'title' ? (bookTitle || t(def.placeholderHe)) : t(def.placeholderHe)}
                      onChange={e => updateField(def.id, { text: e.target.value }, `${t(def.labelHe)} ${t('בעמוד השער עודכן')}`)}
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() => setOpenFieldOptions(isOpen ? null : def.id)}
                      className="shrink-0 px-2.5 rounded-lg border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-surface-subtle)]"
                      aria-expanded={isOpen}
                    >
                      {t('אפשרויות טקסט')} {isOpen ? '▴' : '▾'}
                    </button>
                  </div>
                  {def.id === 'title' && !field.text.trim() && (
                    <p className="text-[10px] text-[var(--ui-text-secondary)]">{t('שם הספר מוצג אם השדה ריק')}</p>
                  )}
                  {isOpen && (
                    <div className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2">
                      <div className="col-span-2">
                        <label className={labelCls}>{t('גופן')}</label>
                        <FontDropdown
                          value={field.fontFamily}
                          availableFonts={availableFonts}
                          onChange={family => updateField(def.id, { fontFamily: family }, `${t(def.labelHe)} ${t('— גופן עודכן')}`)}
                        />
                        <p className="text-[10px] text-[var(--ui-text-secondary)] mt-1">{t('ריק = גופן הספר')}</p>
                      </div>
                      <div>
                        <label className={labelCls}>{t('גודל')}</label>
                        <input
                          type="number"
                          min={6}
                          max={72}
                          step={0.5}
                          value={field.fontSizePt}
                          onChange={e => updateField(def.id, { fontSizePt: Number(e.target.value) || 12 }, `${t(def.labelHe)} ${t('— גודל עודכן')}`)}
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>{t('יישור')}</label>
                        <select
                          value={field.alignment}
                          onChange={e => updateField(def.id, { alignment: e.target.value as TitlePageFieldStyle['alignment'] }, `${t(def.labelHe)} ${t('— יישור עודכן')}`)}
                          className={inputCls}
                        >
                          <option value="center">{t('מרכז')}</option>
                          <option value="right">{t('ימין')}</option>
                          <option value="left">{t('שמאל')}</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>{t('מרווח מעל / מתחת')}</label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={0}
                            max={72}
                            step={1}
                            value={field.spaceAbovePt}
                            title={t('מרווח מעל / מתחת')}
                            onChange={e => updateField(def.id, { spaceAbovePt: Math.max(0, Number(e.target.value) || 0) }, `${t(def.labelHe)} ${t('— מרווח עודכן')}`)}
                            className={inputCls}
                          />
                          <input
                            type="number"
                            min={0}
                            max={72}
                            step={1}
                            value={field.spaceBelowPt}
                            title={t('מרווח מעל / מתחת')}
                            onChange={e => updateField(def.id, { spaceBelowPt: Math.max(0, Number(e.target.value) || 0) }, `${t(def.labelHe)} ${t('— מרווח עודכן')}`)}
                            className={inputCls}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>{t('מרווח שורות')}</label>
                        <input
                          type="number"
                          min={1}
                          max={2}
                          step={0.05}
                          value={field.lineHeight ?? 1.2}
                          title={t('מרווח שורות')}
                          onChange={e => updateField(def.id, { lineHeight: Math.max(1, Math.min(2, Number(e.target.value) || 1.2)) }, `${t(def.labelHe)} ${t('— מרווח שורות עודכן')}`)}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* v0.9.9: extra title-page metadata (template fields). Every
              field is optional — blank stays blank and is never printed.
              Nothing here is invented by the app: fill only what the book
              actually has. These fields render in the preview; the PDF
              renders them only after the coordinator wires the PDF path
              (see title-page-templates.ts) — until then, copy a field into
              a free extra line below if it must appear in print. */}
          <div className="space-y-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2.5">
            <button
              type="button"
              onClick={() => setShowMetadata(!showMetadata)}
              className="w-full flex items-center justify-between text-start"
              aria-expanded={showMetadata}
            >
              <span className="text-[11px] font-semibold text-[var(--ui-text-primary)]">{t('פרטים נוספים לשער')}</span>
              <span className="text-[11px] text-[var(--ui-text-secondary)]">{showMetadata ? '▴' : '▾'}</span>
            </button>
            {showMetadata && (
              <div className="space-y-3 pt-1">
                <p className="text-[10px] text-[var(--ui-text-secondary)]">
                  {t('שדות ריקים נשארים ריקים ולא מודפסים.')}
                </p>
                {visibleMetadataKeys.map(key => {
                  const value = (templateMetadata[key] as string | undefined) ?? '';
                  const isDescription = key === 'description';
                  return (
                    <div key={key} className="space-y-1">
                      <label className={labelCls}>{t(TITLE_PAGE_METADATA_LABELS_HE[key])}</label>
                      {isDescription ? (
                        <textarea
                          rows={2}
                          value={value}
                          placeholder={t(TITLE_PAGE_METADATA_PLACEHOLDERS_HE[key])}
                          onChange={e => updateMetadata(key, e.target.value)}
                          className={inputCls}
                        />
                      ) : (
                        <input
                          type="text"
                          value={value}
                          placeholder={t(TITLE_PAGE_METADATA_PLACEHOLDERS_HE[key])}
                          onChange={e => updateMetadata(key, e.target.value)}
                          className={inputCls}
                        />
                      )}
                    </div>
                  );
                })}
                {activeTemplateId === 'thin_double_minimal' && (
                  <div className="space-y-1.5">
                    <label className={labelCls}>{t('סגנון הכותרת')}</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['upright', 'boldItalic'] as const).map(opt => {
                        const isActive = (templateMetadata.titleStyle ?? 'upright') === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => updateMetadata('titleStyle', opt === 'upright' ? undefined : opt)}
                            className={`py-1.5 px-2 rounded-md border text-[11px] font-medium transition-colors ${
                              isActive
                                ? 'border-[var(--ui-accent)] bg-[var(--ui-selected-bg)] text-[var(--ui-accent)] font-semibold'
                                : 'border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-text-secondary)]'
                            }`}
                            aria-pressed={isActive}
                          >
                            {t(opt === 'upright' ? 'ישר' : 'מודגש נטוי')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>{t('רקע עמוד השער')}</label>
                    <select
                      value={templateMetadata.backgroundOverride ?? ''}
                      onChange={e => updateMetadata('backgroundOverride', e.target.value || undefined)}
                      className={inputCls}
                    >
                      <option value="">{t('ברירת מחדל של התבנית')}</option>
                      <option value="plain">{t('חלק')}</option>
                      <option value="warm">{t('חם')}</option>
                      <option value="textured">{t('מרקם עדין')}</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{t('סמל מוציא לאור')}</label>
                    <select
                      value={templateMetadata.emblemId ?? ''}
                      onChange={e => updateMetadata('emblemId', e.target.value || undefined)}
                      className={inputCls}
                    >
                      <option value="">{t('ברירת מחדל של התבנית')}</option>
                      <option value="none">{t('בלי סמל')}</option>
                      {titlePageOrnaments.map(orn => (
                        <option key={orn.id} value={orn.id}>{orn.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Extra lines */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t('שורות נוספות')}</label>
            {tp.extraLines.map((line, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={line.text}
                    placeholder={t('שורה נוספת (הקדשה, הסכמה…)')}
                    onChange={e =>
                      update(next => {
                        next.extraLines = next.extraLines.map((l, j) => (j === i ? { ...l, text: e.target.value } : l));
                      }, 'שורה נוספת בעמוד השער עודכנה')
                    }
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={() => setOpenExtraOptions(openExtraOptions === i ? null : i)}
                    className="shrink-0 px-2 rounded-lg border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-surface-subtle)]"
                    aria-expanded={openExtraOptions === i}
                  >
                    {t('אפשרויות טקסט')} {openExtraOptions === i ? '▴' : '▾'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      update(next => {
                        next.extraLines = next.extraLines.filter((_, j) => j !== i);
                      }, 'שורה נוספת הוסרה מעמוד השער')
                    }
                    className="shrink-0 px-2 rounded-lg border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] hover:bg-[var(--ui-surface-subtle)]"
                    aria-label={t('הסר שורה')}
                  >
                    ✕
                  </button>
                </div>
                {openExtraOptions === i && (
                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2">
                    <div>
                      <label className={labelCls}>{t('גודל')}</label>
                      <input
                        type="number"
                        min={6}
                        max={72}
                        step={0.5}
                        value={line.fontSizePt}
                        onChange={e =>
                          update(next => {
                            next.extraLines = next.extraLines.map((l, j) => (j === i ? { ...l, fontSizePt: Number(e.target.value) || 12 } : l));
                          }, 'שורה נוספת — גודל עודכן')
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t('יישור')}</label>
                      <select
                        value={line.alignment}
                        onChange={e =>
                          update(next => {
                            next.extraLines = next.extraLines.map((l, j) => (j === i ? { ...l, alignment: e.target.value as TitlePageFieldStyle['alignment'] } : l));
                          }, 'שורה נוספת — יישור עודכן')
                        }
                        className={inputCls}
                      >
                        <option value="center">{t('מרכז')}</option>
                        <option value="right">{t('ימין')}</option>
                        <option value="left">{t('שמאל')}</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{t('מרווח שורות')}</label>
                      <input
                        type="number"
                        min={1}
                        max={2}
                        step={0.05}
                        value={line.lineHeight ?? 1.2}
                        onChange={e =>
                          update(next => {
                            next.extraLines = next.extraLines.map((l, j) => (j === i ? { ...l, lineHeight: Math.max(1, Math.min(2, Number(e.target.value) || 1.2)) } : l));
                          }, 'שורה נוספת — מרווח שורות עודכן')
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {tp.extraLines.length < TITLE_PAGE_MAX_EXTRA_LINES && (
              <button
                type="button"
                onClick={() =>
                  update(next => {
                    next.extraLines = [
                      ...next.extraLines,
                      { text: '', fontFamily: '', fontSizePt: 12, alignment: 'center', spaceAbovePt: 4, spaceBelowPt: 4 },
                    ];
                  }, 'שורה נוספת נוספה לעמוד השער')
                }
                className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-subtle)]"
              >
                + {t('הוסף שורה')}
              </button>
            )}
          </div>

          {/* Border picker */}
          <div className="space-y-2">
            <label className={labelCls}>{t('מסגרת')}</label>
            <div className="grid grid-cols-4 gap-2">
              {TITLE_PAGE_BORDER_STYLES.map(style => {
                const active =
                  !tp.customBorderImage && tp.border.enabled && tp.border.styleId === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() =>
                      update(next => {
                        next.customBorderImage = null;
                        next.border = { ...next.border, enabled: true, styleId: style.id };
                        // v0.9.9: a hand-picked frame replaces the template's
                        // frame, so the template is cleared (its other
                        // typography stays as set until re-applied).
                        delete (next as unknown as Record<string, unknown>).templateId;
                      }, lang === 'en' ? `Title-page border: ${style.nameEn}` : `מסגרת עמוד השער: ${style.nameHe}`)
                    }
                    className={`rounded-lg border p-1 text-center ${active ? 'border-[var(--ui-accent)] ring-1 ring-[var(--ui-accent)]' : 'border-[var(--ui-border)] hover:bg-[var(--ui-surface-subtle)]'}`}
                    aria-pressed={active}
                  >
                    <TitlePageBorderPreview
                      styleId={style.id}
                      thicknessPt={tp.border.thicknessPt}
                      insetMm={tp.border.insetMm}
                      className="w-full h-16 rounded"
                    />
                    <span className="block mt-1 text-[10px] leading-tight text-[var(--ui-text-primary)]">{lang === 'en' ? style.nameEn : style.nameHe}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--ui-text-secondary)]">
              {lang === 'en' ? (TITLE_PAGE_BORDER_STYLES.find(s => s.id === tp.border.styleId)?.descriptionEn ?? '') : t(TITLE_PAGE_BORDER_STYLES.find(s => s.id === tp.border.styleId)?.descriptionHe ?? '')}
            </p>
          </div>

          {/* Border controls */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-[var(--ui-text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={tp.border.enabled}
                onChange={e =>
                  update(next => { next.border = { ...next.border, enabled: e.target.checked }; }, e.target.checked ? 'מסגרת עמוד השער הוצגה' : 'מסגרת עמוד השער הוסתרה')
                }
                className="w-4 h-4 accent-[var(--ui-accent)]"
              />
              <span className="font-semibold">{t('הצג מסגרת')}</span>
            </label>
            {tp.border.enabled && !tp.customBorderImage && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>
                    {t('עובי המסגרת')} · {tp.border.thicknessPt}pt
                  </label>
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.25}
                    value={tp.border.thicknessPt}
                    onChange={e =>
                      update(next => { next.border = { ...next.border, thicknessPt: Number(e.target.value) }; }, 'עובי מסגרת עמוד השער עודכן')
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    {t('מרחק מהקצה')} · {tp.border.insetMm}
                    {'mm'}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={25}
                    step={1}
                    value={tp.border.insetMm}
                    onChange={e =>
                      update(next => { next.border = { ...next.border, insetMm: Number(e.target.value) }; }, 'מרחק מסגרת עמוד השער עודכן')
                    }
                    className="w-full"
                  />
                </div>
              </div>
            )}
            {/* v0.6.0 Part C (§8): border fit — scale, padding and position,
                for the stock frame and for an imported frame image alike. */}
            {tp.border.enabled && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>
                    {t('קנה מידה של המסגרת')} · {tp.border.scalePct ?? 100}%
                  </label>
                  <input
                    type="range"
                    min={50}
                    max={150}
                    step={5}
                    value={tp.border.scalePct ?? 100}
                    onChange={e =>
                      update(next => { next.border = { ...next.border, scalePct: Number(e.target.value) }; }, 'קנה מידה של מסגרת עמוד השער עודכן')
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    {t('ריפוד פנימי')} · {tp.border.paddingMm ?? 0}
                    {'mm'}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={25}
                    step={1}
                    value={tp.border.paddingMm ?? 0}
                    onChange={e =>
                      update(next => { next.border = { ...next.border, paddingMm: Number(e.target.value) }; }, 'ריפוד מסגרת עמוד השער עודכן')
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className={labelCls}>{t('הזזה אופקית (mm)')}</label>
                  <input
                    type="number"
                    min={-25}
                    max={25}
                    step={1}
                    value={tp.border.offsetXMm ?? 0}
                    onChange={e =>
                      update(next => { next.border = { ...next.border, offsetXMm: Math.max(-25, Math.min(25, Number(e.target.value) || 0)) }; }, 'מיקום מסגרת עמוד השער עודכן')
                    }
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t('הזזה אנכית (mm)')}</label>
                  <input
                    type="number"
                    min={-25}
                    max={25}
                    step={1}
                    value={tp.border.offsetYMm ?? 0}
                    onChange={e =>
                      update(next => { next.border = { ...next.border, offsetYMm: Math.max(-25, Math.min(25, Number(e.target.value) || 0)) }; }, 'מיקום מסגרת עמוד השער עודכן')
                    }
                    className={inputCls}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Custom border import */}
          <div className="space-y-1.5">
            <label className={labelCls}>{t('מסגרת מותאמת אישית')}</label>
            {tp.customBorderImage ? (
              <div className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)] p-2 space-y-1">
                <p className="text-[11px] text-[var(--ui-text-primary)] break-all">{tp.customBorderImage.fileName}</p>
                <p className="text-[10px] text-[var(--ui-text-secondary)]">
                  {tp.customBorderImage.persisted
                    ? t('המסגרת המותאמת נשמרה עם הפרויקט')
                    : t('התמונה גדולה מדי לשמירה בקובץ הפרויקט — היא תישמר רק להפעלה הנוכחית.')}
                </p>
                <p className="text-[10px] text-[var(--ui-text-secondary)]">{t('המסגרת המותאמת מחליפה את מסגרת ברירת המחדל')}</p>
                <button
                  type="button"
                  onClick={() =>
                    update(next => { next.customBorderImage = null; }, 'מסגרת מותאמת הוסרה מעמוד השער')
                  }
                  className="px-2.5 py-1 rounded-lg border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface)]"
                >
                  {t('הסר מסגרת מותאמת')}
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-subtle)] disabled:opacity-50"
                >
                  {isImporting ? '…' : t('ייבוא מסגרת')}
                </button>
                <p className="text-[10px] text-[var(--ui-text-secondary)]">{t('קובץ תמונה (PNG, JPG, SVG)')}</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={e => {
                void handleImportFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {importNote && <p className="text-[10px] text-[var(--ui-warning)]">{importNote}</p>}
          </div>

          <Hint>{t('לחץ על שדה בעמוד השער כדי לערוך אותו, או גרור אותו כדי להזיז אותו על העמוד.')}</Hint>
        </>
      )}
    </div>
  );
};
