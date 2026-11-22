import React, { useMemo, useState } from 'react';
import { FileSearch, Printer, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { PageTypesetResult } from '../types/typesetter';
import { PdfExporter } from '../engine/pdf-exporter';
import { useLanguage } from '../i18n/LanguageContext';

interface Props { page: PageTypesetResult; pageIndex: number; }

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
};

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, ch => HTML_ENTITIES[ch] ?? ch);

function family(name: string) {
  const n = (name || '').toLowerCase();
  if (n.includes('david')) return "'David Libre', 'Noto Sans Hebrew', sans-serif";
  if (n.includes('rashi') || n.includes('noto')) return "'Noto Rashi Hebrew', 'Frank Ruhl Libre', serif";
  return "'Frank Ruhl Libre', 'David Libre', serif";
}

/**
 * Integrated diagnostic route: uses Keter's exact PDF render plan for the active
 * page, renders visible text as real selectable DOM text, and opens browser print
 * so the developer can save a test PDF. This does not replace production export.
 */
export const ChromiumPdfDiagnosticPanel: React.FC<Props> = ({ page, pageIndex }) => {
  const { t, dir } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = useMemo(() => PdfExporter.buildPageRenderPlan(page), [page]);
  const wordCount = plan.lines.reduce((count, line) => count + line.words.length, 0);

  const openPrintPreview = () => {
    setError(null);
    try {
      const geometry = page.geometry;
      const words = plan.lines.flatMap(line => line.words.map(word => {
        const right = geometry.pageWidth - word.xRight;
        const font = family(word.fontFamily || line.fontFamily);
        const color = word.textColor || line.textColor || '#111';
        const weight = word.fontWeight || line.baseFontWeight || 400;
        const transform = 'translateY(-0.82em)';
        return '<span style="position:absolute;display:block;white-space:pre;right:' + right +
          'pt;top:' + word.yBaseline + 'pt;width:' + word.width +
          'pt;font-family:' + font + ';font-size:' + word.fontSizePt +
          'pt;font-weight:' + weight + ';line-height:1;direction:rtl;unicode-bidi:isolate;' +
          'text-align:right;overflow:visible;color:' + escapeHtml(color) +
          ';transform:' + transform + '">' + escapeHtml(word.text) + '</span>';
      })).join('');
      const html = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">' +
        '<title>Keter PDF diagnostic</title><style>' +
        '@page{size:' + geometry.pageWidth + 'pt ' + geometry.pageHeight + 'pt;margin:0}' +
        '*{box-sizing:border-box}html,body{margin:0;padding:0;width:' + geometry.pageWidth +
        'pt;height:' + geometry.pageHeight + 'pt;background:white}' +
        '.page{position:relative;width:' + geometry.pageWidth + 'pt;height:' +
        geometry.pageHeight + 'pt;overflow:hidden;background:white;color:#111}' +
        '@media screen{body{padding:20px;background:#ddd}.page{box-shadow:0 2px 12px #888}}' +
        '</style></head><body><div class="page">' + words +
        '</div><script>window.addEventListener("load",()=>setTimeout(()=>window.print(),350));</script></body></html>';
      const popup = window.open('', '_blank');
      if (!popup) {
        setError(t("הדפדפן חסם חלון חדש. אפשר לאפשר חלונות קופצים ולנסות שוב."));
        return;
      }
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section dir={dir} className="bg-[var(--ui-surface)] border border-amber-500/40 rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
            <FileSearch className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[var(--ui-text-primary)]">{t("בדיקת PDF משולבת — Chromium")}</h2>
            <p className="text-xs text-[var(--ui-text-secondary)] mt-1 leading-relaxed">
              
              {t("בדיקת עמוד")} {pageIndex + 1}  {t("מתוך ממשק כתר. משתמשת בקואורדינטות של PdfExporter,\n              ומייצרת טקסט גלוי שאפשר לסמן ולהעתיק. אינה משנה את הייצוא הרגיל.")}
            </p>
            <p className="text-[11px] text-[var(--ui-text-muted)] mt-1">
              {plan.lines.length}  {t("שורות ·")} {wordCount}  {t("מילים ·")} {Math.round(page.geometry.pageWidth)}×{Math.round(page.geometry.pageHeight)}  {t("נקודות")}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => setExpanded(v => !v)}
          className="p-2 rounded-md border border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)]"
          aria-label={expanded ? t("צמצם פרטים") : t("הצג פרטים")}>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
      {expanded && (
        <div className="rounded-lg bg-[var(--ui-surface-subtle)] p-3 text-xs text-[var(--ui-text-secondary)] leading-relaxed">
          <p>{t("הבדיקה בנויה מהעמוד הפעיל עצמו, ולא מדוגמת טקסט נפרדת. הטקסט ב-PDF נוצר כדמו של Chromium עם מיקום מוחלט לפי תוכנית העימוד של כתר.")}</p>
          <p className="mt-1">{t("יש לבדוק: האם הניקוד יושב נכון, האם בחירת מילה וחיפוש עובדים ב-Acrobat, והאם התצוגה דומה לעמוד שבחלון העריכה.")}</p>
          <p className="mt-1 font-semibold">{t("הקובץ שייווצר דרך חלון ההדפסה הוא קובץ בדיקה בלבד; הייצוא הרגיל של כתר לא משתנה.")}</p>
        </div>
      )}
      {error && <div className="flex gap-2 items-start text-xs text-red-600"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
      <button type="button" onClick={openPrintPreview}
        className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold flex items-center justify-center gap-2">
        <Printer className="w-4 h-4" />  {t("פתח PDF לבדיקה (שמירה דרך הדפסה)")}
      </button>
    </section>
  );
};
