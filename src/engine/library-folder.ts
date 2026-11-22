/**
 * Keter Local Library Folder (v0.3.0)
 *
 * Lets the user drop their OWN .docx / .txt files (via a file input — no
 * server, no corpus, no accounts, no Otzaria) and groups them into
 * Masechet + Rashi / Tosafot pairs purely from filename heuristics, in
 * Hebrew and in English transliteration.
 *
 * The engine only detects and describes pairs. The actual import is done
 * by the parent App wiring, which reuses the existing DocxImporter and the
 * existing `rav_text` layout — see `openAsGemaraPage` and the wiring
 * snippet in the v0.3.0 report.
 */

/** One detected Masechet pair from the user's own files. */
export interface LibraryPair {
  /** Masechet name in Hebrew, e.g. 'ברכות'. */
  masechet: string;
  /** Masechet name in Latin transliteration, e.g. 'berakhot'. */
  masechetEn: string;
  /** The main (Gemara) file, when one was found. */
  mainFile?: File;
  /** The Rashi file, when one was found. */
  rashiFile?: File;
  /** The Tosafot file, when one was found. */
  tosafotFile?: File;
  /** Files that matched this masechet but no known role marker. */
  otherFiles: File[];
}

/** Descriptor for opening a pair as a Vilna-Shas (rav_text) page. */
export interface GemaraPageDescriptor {
  layout: 'rav_text';
  masechet: string;
  masechetEn: string;
  /** Files to feed to DocxImporter.importDocx, in import order. */
  files: File[];
  /** Role of each file, parallel to `files`. */
  roles: Array<'main_source' | 'primary_comment' | 'secondary_comment'>;
}

/** A file that could not be paired with any masechet. */
export interface UnpairedLibraryFile {
  file: File;
  reasonHe: string;
  reasonEn: string;
}

/** Known masechtot: Hebrew name → Latin transliteration + common aliases. */
const MASECHTOT: Array<{ he: string; en: string; aliases: string[] }> = [
  { he: 'ברכות', en: 'berakhot', aliases: ['berachot', 'brachot', 'brachos', 'berachos'] },
  { he: 'שבת', en: 'shabbat', aliases: ['shabbos', 'sabbath'] },
  { he: 'עירובין', en: 'eruvin', aliases: ['eiruvin', 'erubin'] },
  { he: 'פסחים', en: 'pesachim', aliases: ['pesach', 'pesahim'] },
  { he: 'שקלים', en: 'shekalim', aliases: ['shekalim'] },
  { he: 'יומא', en: 'yoma', aliases: ['yomah'] },
  { he: 'סוכה', en: 'sukkah', aliases: ['succah', 'sukkot'] },
  { he: 'ביצה', en: 'beitza', aliases: ['beitzah', 'beytzah'] },
  { he: 'ראש השנה', en: 'rosh-hashana', aliases: ['rosh-hashanah', 'rosh hashana', 'rh'] },
  { he: 'תענית', en: 'taanit', aliases: ['taanis', 'taanith'] },
  { he: 'מגילה', en: 'megillah', aliases: ['megila', 'megilah'] },
  { he: 'מועד קטן', en: 'moed-katan', aliases: ['moed katan', 'moedkatan'] },
  { he: 'חגיגה', en: 'chagigah', aliases: ['chagiga', 'hagigah'] },
  { he: 'יבמות', en: 'yevamot', aliases: ['yevamos', 'yebamot'] },
  { he: 'כתובות', en: 'ketubot', aliases: ['kesubos', 'ketubos', 'ketuvot'] },
  { he: 'נדרים', en: 'nedarim', aliases: ['nedarim'] },
  { he: 'נזיר', en: 'nazir', aliases: ['nazir'] },
  { he: 'סוטה', en: 'sotah', aliases: ['sotah'] },
  { he: 'גיטין', en: 'gittin', aliases: ['gittin'] },
  { he: 'קידושין', en: 'kiddushin', aliases: ['kiddushin'] },
  { he: 'בבא קמא', en: 'bava-kamma', aliases: ['bava kama', 'bava kamma', 'bk'] },
  { he: 'בבא מציעא', en: 'bava-metzia', aliases: ['bava metzia', 'bava metziah', 'bm'] },
  { he: 'בבא בתרא', en: 'bava-batra', aliases: ['bava batra', 'bb'] },
  { he: 'סנהדרין', en: 'sanhedrin', aliases: ['sanhedrin'] },
  { he: 'מכות', en: 'makkot', aliases: ['makkos', 'makot'] },
  { he: 'שבועות', en: 'shevuot', aliases: ['shevuos', 'shavuos', 'shavuot'] },
  { he: 'עבודה זרה', en: 'avoda-zara', aliases: ['avodah zarah', 'avoda zara', 'az'] },
  { he: 'הוריות', en: 'horayot', aliases: ['horayos', 'horayoth'] },
  { he: 'זבחים', en: 'zevachim', aliases: ['zevachims', 'zevahim'] },
  { he: 'מנחות', en: 'menachot', aliases: ['menachos', 'menahot'] },
  { he: 'חולין', en: 'chullin', aliases: ['chulin', 'hullin'] },
  { he: 'בכורות', en: 'bechorot', aliases: ['bechoros', 'bechorot'] },
  { he: 'ערכין', en: 'arachin', aliases: ['erchin', 'arakhin'] },
  { he: 'תמורה', en: 'temurah', aliases: ['temura', 'temurah'] },
  { he: 'כריתות', en: 'keritot', aliases: ['krisos', 'keritot'] },
  { he: 'מעילה', en: 'meilah', aliases: ['meila', 'meilah'] },
  { he: 'נידה', en: 'niddah', aliases: ['nidah', 'nida'] },
];

/** Role markers matched against the (lower-cased, nikud-stripped) filename. */
const RASHI_MARKERS = ['רש״י', 'רשי', 'rashi'];
const TOSAFOT_MARKERS = ['תוספות', 'תוס׳', 'תוס', 'tosafot', 'tosfos', 'tosafos'];
const MAIN_MARKERS = ['גמרא', 'gemara', 'gemorah', 'shas', 'ש״ס'];

function stripNikud(s: string): string {
  return s.replace(/[\u0591-\u05C7]/g, '');
}

/** Lower-cased filename without extension, nikud stripped, separators unified. */
function normalizedFileName(file: File): string {
  return stripNikud(file.name)
    .replace(/\.(docx|txt|md)$/i, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .trim();
}

function detectMasechet(normName: string): { he: string; en: string } | null {
  for (const m of MASECHTOT) {
    const candidates = [m.he, m.en, ...m.aliases].map(a =>
      stripNikud(a).toLowerCase().replace(/[_\-.]+/g, ' ').trim()
    );
    if (candidates.some(c => c && normName.includes(c))) {
      return { he: m.he, en: m.en };
    }
  }
  return null;
}

function detectRole(normName: string): 'main_source' | 'primary_comment' | 'secondary_comment' | null {
  if (TOSAFOT_MARKERS.some(m => normName.includes(m))) return 'secondary_comment';
  if (RASHI_MARKERS.some(m => normName.includes(m))) return 'primary_comment';
  if (MAIN_MARKERS.some(m => normName.includes(m))) return 'main_source';
  return null;
}

/**
 * Groups the user's own files into Masechet + Rashi / Tosafot pairs.
 * Only .docx / .txt / .md files are considered; anything else is reported
 * as unpaired. A file whose masechet cannot be recognised is unpaired too —
 * nothing is guessed, and nothing is fetched from anywhere.
 */
export function detectLibraryPairs(
  files: File[] | FileList
): { pairs: LibraryPair[]; unpaired: UnpairedLibraryFile[] } {
  const list = Array.from(files);
  const pairsByKey = new Map<string, LibraryPair>();
  const unpaired: UnpairedLibraryFile[] = [];

  for (const file of list) {
    if (!/\.(docx|txt|md)$/i.test(file.name)) {
      unpaired.push({
        file,
        reasonHe: 'סוג קובץ לא נתמך — רק DOCX או טקסט',
        reasonEn: 'Unsupported file type — DOCX or plain text only',
      });
      continue;
    }
    const norm = normalizedFileName(file);
    const masechet = detectMasechet(norm);
    if (!masechet) {
      unpaired.push({
        file,
        reasonHe: 'לא זוהתה מסכת בשם הקובץ',
        reasonEn: 'No masechet recognised in the file name',
      });
      continue;
    }
    const key = masechet.en;
    let pair = pairsByKey.get(key);
    if (!pair) {
      pair = { masechet: masechet.he, masechetEn: masechet.en, otherFiles: [] };
      pairsByKey.set(key, pair);
    }
    const role = detectRole(norm);
    if (role === 'primary_comment' && !pair.rashiFile) {
      pair.rashiFile = file;
    } else if (role === 'secondary_comment' && !pair.tosafotFile) {
      pair.tosafotFile = file;
    } else if (role === 'main_source' && !pair.mainFile) {
      pair.mainFile = file;
    } else {
      pair.otherFiles.push(file);
    }
  }

  return { pairs: Array.from(pairsByKey.values()), unpaired };
}

/**
 * Builds the descriptor for opening a detected pair as a Vilna-Shas page.
 * Returns only the descriptor + file references — the parent App wiring
 * performs the actual import (DocxImporter.importDocx per file, then the
 * existing rav_text import flow). The main file is imported first so the
 * dibur-hamatchil auto-linking can anchor Rashi / Tosafot to it.
 */
export function openAsGemaraPage(pair: LibraryPair): GemaraPageDescriptor {
  const files: File[] = [];
  const roles: GemaraPageDescriptor['roles'] = [];
  if (pair.mainFile) {
    files.push(pair.mainFile);
    roles.push('main_source');
  }
  if (pair.rashiFile) {
    files.push(pair.rashiFile);
    roles.push('primary_comment');
  }
  if (pair.tosafotFile) {
    files.push(pair.tosafotFile);
    roles.push('secondary_comment');
  }
  return {
    layout: 'rav_text',
    masechet: pair.masechet,
    masechetEn: pair.masechetEn,
    files,
    roles,
  };
}
