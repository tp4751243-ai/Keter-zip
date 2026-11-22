import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Replace, ReplaceAll, Search, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import type { SearchHit, SearchOptions } from '../engine/hebrew-search';

interface SearchReplacePanelProps {
  /** Runs the search over the document; returns hits in document order. */
  onSearch: (query: string, opts: SearchOptions) => SearchHit[];
  /** Called when the user steps to a hit — parent navigates + highlights it. */
  onJumpToHit: (hit: SearchHit) => void;
  /** Replaces all matches; returns how many were replaced. */
  onReplaceAll: (query: string, replacement: string, opts: SearchOptions) => number;
  /** Replaces one hit (nikud-preserving). Optional: if omitted, the
   *  replace-one button is disabled. */
  onReplaceOne?: (hit: SearchHit, replacement: string, opts: SearchOptions) => void;
  onClose: () => void;
}

export const SearchReplacePanel: React.FC<SearchReplacePanelProps> = ({
  onSearch,
  onJumpToHit,
  onReplaceAll,
  onReplaceOne,
  onClose,
}) => {
  const { t, tf, dir } = useLanguage();
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [nikudInsensitive, setNikudInsensitive] = useState(true);
  const [ktivInsensitive, setKtivInsensitive] = useState(true);
  const [stripPrefixes, setStripPrefixes] = useState(true);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lastReplaceCount, setLastReplaceCount] = useState<number | null>(null);

  const opts: SearchOptions = { nikudInsensitive, ktivInsensitive, stripPrefixes };

  // Live search on every query / option change.
  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setActiveIndex(0);
      return;
    }
    setHits(onSearch(query, opts));
    setActiveIndex(0);
    setLastReplaceCount(null);
    // onSearch is a parent callback; re-running when it changes identity
    // would loop — query/options are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, nikudInsensitive, ktivInsensitive, stripPrefixes]);

  const jumpTo = (index: number) => {
    if (hits.length === 0) return;
    const next = ((index % hits.length) + hits.length) % hits.length;
    setActiveIndex(next);
    onJumpToHit(hits[next]);
  };

  const handleReplaceAll = () => {
    if (!query.trim()) return;
    const count = onReplaceAll(query, replacement, opts);
    setLastReplaceCount(count);
    setHits(onSearch(query, opts));
    setActiveIndex(0);
  };

  const handleReplaceOne = () => {
    if (!onReplaceOne || hits.length === 0) return;
    onReplaceOne(hits[activeIndex], replacement, opts);
    setHits(onSearch(query, opts));
    setActiveIndex(i => Math.min(i, Math.max(0, hits.length - 2)));
  };

  const activeHit = hits.length > 0 ? hits[activeIndex] : null;

  return (
    <div
      dir={dir}
      className="fixed bottom-11 left-5 w-[26rem] max-w-[calc(100vw-2.5rem)] bg-[var(--ui-surface)] border border-[var(--ui-border)] shadow-[var(--ui-floating-shadow)] rounded-xl z-50 overflow-hidden text-[var(--ui-text-primary)]"
    >
      {/* Header */}
      <div className="h-10 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-3.5">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-[var(--ui-accent)]" />
          <span className="text-xs font-semibold text-[var(--ui-text-primary)]">
            {t('חיפוש והחלפה')}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]"
          title={t('סגירה')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3.5 space-y-3 text-xs">
        {/* Search input */}
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') jumpTo(e.shiftKey ? activeIndex - 1 : activeIndex + 1);
            }}
            placeholder={t('חיפוש בטקסט…')}
            className="flex-1 min-w-0 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-sm text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-muted)] focus:outline-none focus:border-[var(--ui-accent)]"
          />
          <button
            onClick={() => jumpTo(activeIndex + 1)}
            disabled={hits.length === 0}
            className="p-2 rounded-lg border border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)] disabled:opacity-40"
            title={t('הבא')}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            onClick={() => jumpTo(activeIndex - 1)}
            disabled={hits.length === 0}
            className="p-2 rounded-lg border border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)] disabled:opacity-40"
            title={t('הקודם')}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>

        {/* Match count */}
        <div className="text-[var(--ui-text-secondary)]">
          {query.trim() === '' ? (
            t('הקלידו מילת חיפוש')
          ) : hits.length === 0 ? (
            t('לא נמצאו תוצאות')
          ) : (
            tf('נמצאו {count} מופעים', { count: hits.length }) +
            (activeHit ? ` — ${activeIndex + 1} / ${hits.length}` : '')
          )}
        </div>

        {/* Replace input */}
        <div className="flex items-center gap-2">
          <input
            value={replacement}
            onChange={e => setReplacement(e.target.value)}
            placeholder={t('החלפה ב…')}
            className="flex-1 min-w-0 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-sm text-[var(--ui-text-primary)] placeholder:text-[var(--ui-text-muted)] focus:outline-none focus:border-[var(--ui-accent)]"
          />
          <button
            onClick={handleReplaceOne}
            disabled={!onReplaceOne || hits.length === 0 || !query.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--ui-border)] hover:bg-[var(--ui-surface-hover)] disabled:opacity-40"
            title={onReplaceOne ? t('החלפת המופע הנוכחי') : t('החלפה בודדת — לא מחוברת עדיין')}
          >
            <Replace className="w-3.5 h-3.5" />
            {t('החלף')}
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={hits.length === 0 || !query.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--ui-accent)] text-white hover:opacity-90 disabled:opacity-40"
            title={t('החלפת כל המופעים')}
          >
            <ReplaceAll className="w-3.5 h-3.5" />
            {t('החלף הכל')}
          </button>
        </div>
        {lastReplaceCount !== null && (
          <div className="text-[var(--ui-text-secondary)]">
            {tf('הוחלפו {count} מופעים', { count: lastReplaceCount })}
          </div>
        )}

        {/* Matching options */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1 border-t border-[var(--ui-border)]">
          <label className="flex items-center gap-1.5 cursor-pointer text-[var(--ui-text-secondary)]">
            <input
              type="checkbox"
              checked={nikudInsensitive}
              onChange={e => setNikudInsensitive(e.target.checked)}
              className="accent-[var(--ui-accent)]"
            />
            {t('התעלם מניקוד וטעמים')}
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-[var(--ui-text-secondary)]">
            <input
              type="checkbox"
              checked={ktivInsensitive}
              onChange={e => setKtivInsensitive(e.target.checked)}
              className="accent-[var(--ui-accent)]"
            />
            {t('כתיב מלא / חסר')}
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-[var(--ui-text-secondary)]">
            <input
              type="checkbox"
              checked={stripPrefixes}
              onChange={e => setStripPrefixes(e.target.checked)}
              className="accent-[var(--ui-accent)]"
            />
            {t('התעלם מאותיות מש״ה וכל״ב')}
          </label>
        </div>
      </div>
    </div>
  );
};
