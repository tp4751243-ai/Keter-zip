/**
 * Layout training T8 — the brace-tag source format.
 *
 * The user's tagged sources (e.g. Mesilat Yesharim) mark structure with
 * curly-brace tags, one per paragraph:
 *
 *   {שם הספר: מסילת ישרים}     metadata — key: value
 *   {9מסילת ישרים9}             level 9 — the book title (title page / opening)
 *   {2פרק א2}                   level 2 — perek heading
 *   {3בבאור כלל חובת האדם בעולמו3}  level 3 — the perek's subtitle
 *
 * The level digit opens and closes the tag. Untagged paragraphs are body
 * text. Levels without a confirmed meaning yet map to heading levels, so
 * nothing is ever dropped or printed with its braces.
 */
import type { ContentRole, ContentUnit } from '../types/typesetter';

export interface BraceTagRole {
  role: ContentRole;
  hierarchyLevel: number;
  label: string;
}

/** Level → role. 9 / 2 / 3 are from the user's sample; the rest are headings by depth. */
export const DEFAULT_BRACE_TAG_ROLES: Record<number, BraceTagRole> = {
  9: { role: 'main_title', hierarchyLevel: 0, label: 'שם הספר' },
  1: { role: 'heading', hierarchyLevel: 1, label: 'חלק / שער' },
  2: { role: 'chapter', hierarchyLevel: 2, label: 'פרק' },
  3: { role: 'subtitle', hierarchyLevel: 3, label: 'כותרת משנה' },
  4: { role: 'heading', hierarchyLevel: 4, label: 'כותרת 4' },
  5: { role: 'heading', hierarchyLevel: 5, label: 'כותרת 5' },
  6: { role: 'heading', hierarchyLevel: 6, label: 'כותרת 6' },
  7: { role: 'heading', hierarchyLevel: 7, label: 'כותרת 7' },
  8: { role: 'heading', hierarchyLevel: 8, label: 'כותרת 8' },
};

/** Known metadata keys (Hebrew as typed in the source) → field names. */
const META_KEYS: Record<string, string> = {
  'שם הספר': 'title',
  'שם ספר': 'title',
  'מחבר': 'author',
  'שם המחבר': 'author',
  'מהדורה': 'edition',
  'הוצאה': 'publisher',
  'שנה': 'year',
};

export interface BraceTagResult {
  units: ContentUnit[];
  /** Metadata from {key: value} tags (title, author …; unknown keys kept as typed). */
  metadata: Record<string, string>;
  /** How many tags were recognised (0 → the file was not brace-tagged). */
  tagCount: number;
  /** Tags whose closing digit did not match the opening one (kept as headings). */
  warnings: string[];
}

const LEVEL_TAG = /^\{\s*(\d)(.*?)(\d)?\s*\}$/s;
const META_TAG = /^\{\s*([^{}:]{1,30}?)\s*:\s*(.*?)\s*\}$/s;

/** Parse one paragraph. null when it is not a tag. */
export function parseBraceTag(text: string): { kind: 'level'; level: number; text: string; closed: boolean } | { kind: 'meta'; key: string; value: string } | null {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  const lv = LEVEL_TAG.exec(t);
  if (lv) {
    const level = Number(lv[1]);
    return { kind: 'level', level, text: lv[2].trim(), closed: lv[3] === lv[1] };
  }
  const mt = META_TAG.exec(t);
  if (mt) return { kind: 'meta', key: mt[1].trim(), value: mt[2] };
  return null;
}

/** True when the units look brace-tagged (cheap check before the transform). */
export function looksBraceTagged(units: Array<Pick<ContentUnit, 'rawText'>>): boolean {
  let n = 0;
  for (const u of units.slice(0, 400)) if (parseBraceTag(u.rawText ?? '')) n++;
  return n >= 2;
}

/**
 * Turn tag paragraphs into structural units; strip the braces; untagged
 * paragraphs become body paragraphs. Metadata tags leave no unit.
 */
export function applyBraceTags(
  units: ContentUnit[],
  roles: Record<number, BraceTagRole> = DEFAULT_BRACE_TAG_ROLES
): BraceTagResult {
  const out: ContentUnit[] = [];
  const metadata: Record<string, string> = {};
  const warnings: string[] = [];
  let tagCount = 0;
  let currentChapter = '';
  for (const u of units) {
    const tag = parseBraceTag(u.rawText ?? '');
    if (!tag) {
      // Body text keeps its importer role unless the importer guessed a
      // heading for an untagged paragraph — in a tagged file only tags
      // make headings.
      const role: ContentRole =
        u.role === 'heading' || u.role === 'chapter' || u.role === 'main_title' || u.role === 'subtitle' ? 'regular_paragraph' : u.role;
      out.push({ ...u, role, chapterTitle: currentChapter || u.chapterTitle });
      continue;
    }
    tagCount++;
    if (tag.kind === 'meta') {
      metadata[META_KEYS[tag.key] ?? tag.key] = tag.value;
      continue;
    }
    if (!tag.closed) warnings.push(`תג {${tag.level}…} לא נסגר באותה ספרה: "${u.rawText.trim().slice(0, 40)}"`);
    const r = roles[tag.level] ?? { role: 'heading' as ContentRole, hierarchyLevel: tag.level, label: `כותרת ${tag.level}` };
    if (r.role === 'chapter') currentChapter = tag.text;
    out.push({
      ...u,
      rawText: tag.text,
      textRuns: undefined,
      role: r.role,
      hierarchyLevel: r.hierarchyLevel,
      styleName: `Tag ${tag.level}`,
      dibburHamatchil: undefined,
      dibburNode: undefined,
      linkedSourceId: undefined,
    });
  }
  if (!metadata.title) {
    const t = out.find(u => u.role === 'main_title');
    if (t) metadata.title = t.rawText;
  }
  return { units: out, metadata, tagCount, warnings };
}
