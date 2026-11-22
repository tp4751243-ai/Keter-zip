import React from 'react';
import { HebrewGlyph, ShapedWord } from '../types/typesetter';
import { X, Eye } from 'lucide-react';

interface GlyphInspectorProps {
  glyph: HebrewGlyph | null;
  word: ShapedWord | null;
  onClose: () => void;
}

export const GlyphInspector: React.FC<GlyphInspectorProps> = ({
  glyph,
  word,
  onClose,
}) => {
  if (!glyph || !word) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-11 left-5 w-96 bg-[var(--ui-surface)] border border-[var(--ui-border)] shadow-[var(--ui-floating-shadow)] rounded-xl z-50 overflow-hidden text-[var(--ui-text-primary)]"
    >
      {/* Header */}
      <div className="h-10 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-3.5">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-[var(--ui-accent)]" />
          <span className="text-xs font-semibold text-[var(--ui-text-primary)]">
            מנתח גליפים HarfBuzz (OpenType Shaper)
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-3.5 text-xs">
        {/* Word preview & Glyph magnification */}
        <div className="flex items-center justify-between bg-[var(--ui-surface-subtle)] p-3 rounded-lg border border-[var(--ui-border)]">
          <div className="text-right">
            <span className="text-[11px] text-[var(--ui-text-secondary)] block mb-0.5">
              המילה הנבחרת:
            </span>
            <span className="text-xl font-bold font-serif text-[var(--ui-text-primary)]">
              {word.text}
            </span>
            <span className="text-[10px] text-[var(--ui-text-muted)] font-mono block mt-1">
              רוחב מילה כולל: {word.width.toFixed(2)} pt
            </span>
          </div>

          <div className="w-16 h-16 rounded-lg bg-[var(--ui-page-bg)] border border-[var(--ui-page-border)] flex items-center justify-center text-3xl font-serif text-[#20242B] shadow-2xs">
            {glyph.char}
          </div>
        </div>

        {/* Glyph properties table */}
        <div className="bg-[var(--ui-surface-subtle)] rounded-lg p-3 border border-[var(--ui-border)] space-y-2">
          <div className="flex justify-between items-center py-0.5 border-b border-[var(--ui-border)]">
            <span className="text-[var(--ui-text-secondary)]">יוניקוד (Hex Codepoint):</span>
            <span className="font-mono text-[var(--ui-accent)] font-medium">
              {glyph.codepointHex}
            </span>
          </div>

          <div className="flex justify-between items-center py-0.5 border-b border-[var(--ui-border)]">
            <span className="text-[var(--ui-text-secondary)]">סיווג גליף:</span>
            <span className="text-[var(--ui-text-primary)]">
              {glyph.isMark ? (
                <span className="text-[var(--ui-warning)] font-medium">
                  דיאקריט משלב (Non-Spacing Mark: {glyph.markNameHe || glyph.markType})
                </span>
              ) : (
                <span className="text-[var(--ui-success)] font-medium">אות עיצור בסיס</span>
              )}
            </span>
          </div>

          <div className="flex justify-between items-center py-0.5 border-b border-[var(--ui-border)]">
            <span className="text-[var(--ui-text-secondary)]">פסיעה אופקית (xAdvance):</span>
            <span className="font-mono text-[var(--ui-text-primary)]">
              {glyph.xAdvance.toFixed(2)} pt {glyph.isMark ? '(0pt - תו מרחף)' : ''}
            </span>
          </div>

          <div className="flex justify-between items-center py-0.5 border-b border-[var(--ui-border)]">
            <span className="text-[var(--ui-text-secondary)]">
              היסט עוגן x / y (GPOS Anchors):
            </span>
            <span className="font-mono text-[var(--ui-text-primary)]">
              x: {glyph.xOffset.toFixed(2)} pt | y: {glyph.yOffset.toFixed(2)} pt
            </span>
          </div>

          <div className="flex justify-between items-center py-0.5">
            <span className="text-[var(--ui-text-secondary)]">אשכול HarfBuzz (Cluster Index):</span>
            <span className="font-mono text-[var(--ui-text-primary)]">Cluster #{glyph.cluster}</span>
          </div>
        </div>

        {/* Word sub-glyphs breakdown */}
        <div>
          <span className="text-[11px] text-[var(--ui-text-secondary)] block mb-1.5 font-medium">
            רכיבי המילה (אותיות, נקוד וטעמים):
          </span>
          <div className="flex flex-wrap gap-1">
            {word.glyphs.map((g, i) => (
              <span
                key={i}
                className={`px-2 py-1 rounded text-xs font-mono flex items-center gap-1 border ${
                  g.codepoint === glyph.codepoint
                    ? 'bg-[var(--ui-selected-bg)] border-[var(--ui-selected-border)] text-[var(--ui-selected-text)]'
                    : 'bg-[var(--ui-surface-subtle)] border-[var(--ui-border)] text-[var(--ui-text-secondary)]'
                }`}
              >
                <span className="font-serif text-sm font-bold">{g.char}</span>
                <span className="text-[9px] text-[var(--ui-text-muted)]">{g.codepointHex}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
