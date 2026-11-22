/**
 * KETER-TYPE v0.9.3 Part B — classifier + auto-layout + typography smoke.
 *
 * Run from the tree root:  npx tsx scripts/v093-partB-smoke.ts
 *
 * Pure-engine checks (no browser, no React) over the Part B scratch copy:
 *  §1  one synthetic .docx per NEW genre (all 18 research-note recipes
 *      + nusach siddur) auto-selects the right recipe at the right
 *      confidence band
 *  §2  weak hints alone do NOT decide (bare 'mishnah', 'tur', 'rosh
 *      hashanah', 'chumash', 'shulchan aruch', publisher name alone)
 *      + the single-weak + role-pattern band (0.7–0.8)
 *  §3  matcher unit checks (span suppression, Hebrew prefix guards)
 *  §4  suggestRecipe direct checks incl. the v0.9.0 Part A §D
 *      expectations (Vilna / Mikraot / prose / siddur / SA / Yiddish /
 *      unknown fallbacks must be unchanged)
 *  §5  old genres still classify correctly (Vilna, Mikraot, Responsa,
 *      Drush, Yiddish, Tzenerene + both fallbacks — the v0.9.0
 *      Part C §1/§4 checks, rebuilt here)
 *  §6  per-genre typography is actually applied where the engine has
 *      a mechanism (dibbur bold, first/second/none indents, kashya
 *      vs tracking, folio style) + the apply path for recipes Part A
 *      has not added yet does not crash
 *
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { DOMParser } from '@xmldom/xmldom';
// The docx importer runs under tsx (Node), where DOMParser / Node are
// not globals — install the @xmldom shims before importing it.
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;
(globalThis as unknown as { Node: unknown }).Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

import JSZip from 'jszip';
import { DocxImporter } from '../src/engine/docx-importer';
import { DesignSettingsEngine } from '../src/engine/design-settings-engine';
import {
  applyAutoLayout,
  applyRecipeToSettingsById,
  classifyForImport,
} from '../src/engine/auto-layout';
import {
  matchGenreSignals,
  suggestRecipe,
  type DocumentClassification,
} from '../src/engine/historical-layouts';
import type { ContentUnit } from '../src/types/typesetter';

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// --- minimal .docx builder (same pattern as v090-partC-smoke) ---
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (text: string, style?: string): string =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
async function buildDocx(paras: string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

const repeat = (n: number, fn: () => string): string[] => Array.from({ length: n }, fn);

// Shared fixture texts (copied from v090-partC-smoke where the old
// genres are re-run; new-genre texts are written for this smoke).
const GEMARA = 'גמרא: תנא היכא קאי דקתני מאימתי ותו מאי שנא דתני דערבית ברישא לתני דשחרית ברישא תנא אקרא קאי דכתיב בשכבך ובקומך והכי קתני זמן קריאת שמע דשכיבה אימת משעה שהכהנים נכנסין לאכול בתרומתן. ';
const MISHNA = 'משנה: מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל אומר עד שיעלה עמוד השחר. ';
const RASHI = 'מאימתי קורין את שמע בערבית פירוש מאיזה זמן קורין ולא קתני משעה שהכוכבים יוצאים לאשמעינן מילתא אגב אורחיה דהכהנים שנטמאו וטבלו ביום והעריב שמשן טהורים לאכול בתרומה לעת ערב. ';
const TOSAFOT = 'תנא היכא קאי דקתני מאימתי קושיא ותירוץ ארוך בין הראשונים חילוקים וראיות והתוספות מקשים על פירוש רשי ומתרצים בדוחק גדול. ';
const VERSE = 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֣ת הַשָּׁמַ֗יִם וְאֵ֥ת הָאָֽרֶץ׃ ';
const YIDDISH = 'די צאינה וראינה דערצײלט אונדז װען דער מענטש לערנט די תּורה מיט אַן אָפֿן האַרץ. ';

/** The Vilna anatomy (Gemara + Rashi + Tosafot + marginalia) as .docx paras, with a custom title. */
function vilnaAnatomyParas(titleStyle: string, titleText: string): string[] {
  return [
    para(titleText, titleStyle),
    para('מסכת ברכות — פרק ראשון', 'Heading 1'),
    para('דף ב.', 'Folio'),
    para(MISHNA, 'Mishna'),
    ...repeat(12, () => para(GEMARA)),
    ...repeat(12, () => para(RASHI, 'Rashi')),
    ...repeat(12, () => para(TOSAFOT, 'Tosafot')),
    para('עין משפט: סימן א סעיף ב.', 'Ein Mishpat'),
    para('מסורת הש״ס: ברכות דף ג.', 'Masoret HaShas'),
    para('גליון הש״ס: הערה של ר׳ עקיבא איגר.', 'Gilyon'),
  ];
}

/** Build a docx, import it, classify + decide. Returns the decision + classification. */
async function decideDocx(paras: string[], fileName: string) {
  const docx = await buildDocx(paras);
  const imported = await DocxImporter.importDocx(docx, fileName);
  return classifyForImport(imported.units, imported.links, { fileName });
}

function expectRecipe(
  name: string,
  info: { decision: { recipeId: string; confidence: number; isFallback: boolean; lineEn: string } },
  recipeId: string,
  minConf: number,
  maxConf?: number,
): void {
  const d = info.decision;
  const inBand = d.confidence >= minConf && (maxConf === undefined || d.confidence <= maxConf);
  check(
    `${name} → ${recipeId} (conf ${d.confidence})`,
    d.recipeId === recipeId && !d.isFallback && inBand,
    d.lineEn,
  );
}

async function main(): Promise<void> {
  const settings = DesignSettingsEngine.createDefaultSettings();

  console.log('== §1 — one .docx per NEW genre picks the right recipe ==');
  // --- Shas publisher variants (publisher hint + Gemara flanks) ---
  expectRecipe(
    'Oz VeHadar Shas',
    await decideDocx(vilnaAnatomyParas('Title', 'ש״ס עוז והדר'), 'oz-vehadar.docx'),
    'shas-oz-vehadar', 0.9,
  );
  expectRecipe(
    'ArtScroll Schottenstein Shas',
    await decideDocx(vilnaAnatomyParas('Title', 'ArtScroll Schottenstein — Berakhot'), 'artscroll.docx'),
    'shas-artscroll', 0.9,
  );
  expectRecipe(
    'Steinsaltz Talmud',
    await decideDocx(vilnaAnatomyParas('Title', 'Steinsaltz Talmud — Berakhot'), 'steinzaltz.docx'),
    'shas-steinzaltz', 0.9,
  );
  // --- Mishnah Berurah (2+ strong signals: MB + Biur Halacha) ---
  expectRecipe(
    'Mishnah Berurah',
    await decideDocx([
      para('משנה ברורה — אורח חיים', 'Title'),
      para('סימן א סעיף א: יהודי חייב להתחזק בעבודת הבורא.', 'Heading 2'),
      para('סימן א סעיף ב: יתגבר כארי לעמוד בבוקר לעבודת בוראו.', 'Heading 2'),
      ...repeat(4, () => para('מ"ב: אסור להתעכב בתפילה, ויש להקדים לכתחילה ולהתפלל עם הציבור, ודבר זה מבואר בפוסקים.', 'MB')),
      ...repeat(3, () => para('ביאור הלכה: ד״ה יתגבר — ענין ההתגברות הוא כנגד היצר הרע, ויש בזה אריכות דברים.', 'Biur Halacha')),
      ...repeat(2, () => para('שער הציון: עיין לעיל סימן א׳ ס״ק ב׳ ומקורות נוספים.', "Sha'ar HaTziyun")),
    ], 'mishnah-berurah.docx'),
    'mishnah-berurah', 0.9,
  );
  // --- Yerushalmi (yerushalmi + pnei moshe → 2 strong) ---
  expectRecipe(
    'Yerushalmi',
    await decideDocx([
      para('תלמוד ירושלמי — מסכת ברכות', 'Title'),
      para('פרק א הלכה א: מאימתי קורין את שמע בערבית.', 'Heading 1'),
      para('הלכה א: משעה שהכהנים נכנסין לאכול בתרומתן.', 'Normal'),
      ...repeat(4, () => para('פני משה: מאימתי — פירוש מאיזה זמן, והדברים מבוארים בפירוש.', 'Pnei Moshe')),
      ...repeat(3, () => para('קרבן העדה: הערה קצרה על דברי הגמרא ופירושם.', 'Korban HaEdah')),
    ], 'yerushalmi.docx'),
    'yerushalmi', 0.9,
  );
  // --- Mishneh Torah (mishneh torah + kesef mishneh → 2 strong) ---
  expectRecipe(
    'Mishneh Torah',
    await decideDocx([
      para('משנה תורה — הלכות שבת', 'Title'),
      para('פרק א הלכה א: השבת היא אות בין הקדוש ברוך הוא ובין ישראל.', 'Normal'),
      ...repeat(4, () => para('כסף משנה: דין זה מבואר בגמרא שבת דף ב׳ ודברי הרמב״ם כאן כוללים כמה פרטים.', 'Kesef Mishneh')),
      ...repeat(3, () => para('מגיד משנה: מקור הדין הוא מהתוספתא, והרמב״ם פסק כדעת הרי״ף.', 'Maggid Mishneh')),
      ...repeat(2, () => para('ראב״ד: אינו כן, אלא יש לחלק בין מקרה למקרה כמבואר.', 'Raavad')),
    ], 'mishneh-torah.docx'),
    'mishneh-torah', 0.9,
  );
  // --- Mishnah classic (bartenura + mishnah → strong + role pattern) ---
  expectRecipe(
    'Mishnah with Bartenura',
    await decideDocx([
      para('משנה — מסכת ברכות עם פירוש ברטנורא', 'Title'),
      para(MISHNA, 'Mishna'),
      ...repeat(4, () => para('ברטנורא: מאימתי — פירוש מאיזה זמן, והטעם מפני שהכהנים נכנסין לאכול בתרומתן.', 'Bartenura')),
      ...repeat(2, () => para('תוספות יום טוב: הערה על דברי הרב ופירוש נוסף בקצרה.', 'Tosafot Yom Tov')),
    ], 'mishnah.docx'),
    'mishnah-classic', 0.9,
  );
  // --- Mishnah Kehati (1 strong + mishnah-structure role pattern) ---
  // (No Bartenura units here: a real Kehati prints Bartenura too, but
  // its signal would tie with Kehati's inside the same specificity
  // group — the smoke keeps the fixture unambiguous.)
  expectRecipe(
    'Mishnah Kehati',
    await decideDocx([
      para('משנה קהתי — מסכת שבת', 'Title'),
      para('הקדמה למסכת: מבוא קצר לתוכן המסכת ועניניה.', 'Normal'),
      para('משנה: במה מדליקין ובמה אין מדליקין, לא בלכש ולא בחוסן.', 'Mishna'),
      ...repeat(3, () => para('קהתי: הסבר בלשון פשוטה ובהירה של המשנה, מילה במילה.', 'Kehati')),
    ], 'kehati.docx'),
    'mishnah-kehati', 0.9,
  );
  // --- Aruch HaShulchan (1 strong + siman role pattern) ---
  expectRecipe(
    'Aruch HaShulchan',
    await decideDocx([
      para('ערוך השולחן — אורח חיים', 'Title'),
      para('סימן א: דין הנהגת האדם בבוקר ומקורותיו מהגמרא ומהרמב״ם.', 'Heading 2'),
      ...repeat(4, () => para('ביאור מקורות הדין מהגמרא ברכות ומהרמב״ם הלכות תפילה, וסיכום ההלכה למעשה.', 'Normal')),
    ], 'aruch-hashulchan.docx'),
    'aruch-hashulchan', 0.9,
  );
  // --- Tur, strong form (Arba'ah Turim + siman) ---
  expectRecipe(
    'Tur (Arba\'ah Turim)',
    await decideDocx([
      para('ארבעה טורים — אורח חיים', 'Title'),
      para('סימן א: יתגבר כארי לעמוד בבוקר לעבודת בוראו.', 'Heading 2'),
      ...repeat(3, () => para('כתב הב״ח: ביאור דברי הטור ומקורותיו מהראשונים.', 'Bach')),
      ...repeat(2, () => para('דרישה: הערה והסבר על לשון הטור.', 'Drishah')),
    ], 'tur.docx'),
    'tur', 0.9,
  );
  // --- Kitzur Shulchan Aruch (1 strong + siman role pattern) ---
  expectRecipe(
    'Kitzur Shulchan Aruch',
    await decideDocx([
      para('קיצור שולחן ערוך', 'Title'),
      para('סימן א סעיף א: חייב אדם להתחזק בעבודת הבורא בכל יום.', 'Heading 2'),
      ...repeat(4, () => para('דין קצר ומעשי: כיצד נוהגים הלכה למעשה, בפשטות ובקיצור.', 'Normal')),
    ], 'kitzur.docx'),
    'kitzur-shulchan-aruch', 0.9,
  );
  // --- Chumash with Targum + Rashi (onkelos strong + verse pattern) ---
  expectRecipe(
    'Chumash (verse + Targum + Rashi)',
    await decideDocx([
      para('חומש — בראשית', 'Title'),
      ...repeat(3, () => para(VERSE)),
      ...repeat(3, () => para('אונקלוס: בראשית ברא אלהים ית שמיא וית ארעא.', 'Onkelos')),
      ...repeat(3, () => para('בראשית בשביל התורה שנקראת ראשית פירוש קצר על הפסוק.', 'Rashi')),
    ], 'chumash.docx'),
    'chumash', 0.85,
  );
  // --- Nevi'im / Ketuvim with Metzudot + Radak (3 strong) ---
  expectRecipe(
    'Nevi\'im with Metzudot and Radak',
    await decideDocx([
      para('נביאים — ישעיהו עם מצודות ורד״ק', 'Title'),
      ...repeat(3, () => para('כֹּ֥ה אָמַ֖ר ה׳ צְבָא֑וֹת שִׁמְע֥וּ דְבַר־ה׳.', 'Normal')),
      ...repeat(3, () => para('מצודת דוד: כה אמר ה׳ — פירוש קצר וברור של הפסוק.', 'Metzudot')),
      ...repeat(3, () => para('רד״ק: ביאור המילים והדקדוק, עם מקורות מהמקרא.', 'Radak')),
    ], 'neviim.docx'),
    'tanach-commentary', 0.9,
  );
  // --- Midrash Rabbah (midrash rabbah + davar acher → 2 strong) ---
  expectRecipe(
    'Midrash Rabbah',
    await decideDocx([
      para('מדרש רבה — בראשית', 'Title'),
      para('פרשת בראשית', 'Heading 1'),
      ...repeat(3, () => para('דבר אחר: בראשית ברא אלהים — אמר רבי אלעזר, בזכות התורה שנקראת ראשית.', 'Normal')),
      ...repeat(2, () => para('אמר רבי יהושע: המדרש מבאר את הפסוק בדרך של משל ודוגמא.', 'Normal')),
    ], 'midrash.docx'),
    'midrash', 0.9,
  );
  // --- Ein Yaakov (1 strong, no role pattern → 0.87) ---
  expectRecipe(
    'Ein Yaakov',
    await decideDocx([
      para('עין יעקב — מסכת ברכות', 'Title'),
      ...repeat(4, () => para('מעשה ברבי אלעזר שהיה יושב ועוסק בתורה, ובא אליו תלמיד ושאל.', 'Normal')),
    ], 'ein-yaakov.docx'),
    'ein-yaakov', 0.85, 0.9,
  );
  // --- Mussar (1 strong, no role pattern → 0.87) ---
  expectRecipe(
    'Mussar (Mesillat Yesharim)',
    await decideDocx([
      para('מסילת ישרים', 'Title'),
      para('פרק א: ענין הזהירות ומעלתה בעבודת האדם.', 'Heading 1'),
      ...repeat(4, () => para('הזהירות היא יסוד העבודה, והאדם צריך להתבונן תמיד במעשיו ולשקול אותם.', 'Normal')),
    ], 'mesillat.docx'),
    'mussar', 0.85, 0.9,
  );
  // --- Tanya (tanya + likutei amarim → 2 strong) ---
  expectRecipe(
    'Tanya',
    await decideDocx([
      para('תניא — ליקוטי אמרים', 'Title'),
      para('פרק א: נפש האדם מחולקת לשתי נפשות, האחת אלוקית והשניה בהמית.', 'Heading 1'),
      ...repeat(4, () => para('ביאור ענין הנפשות ומלחמתן, וכיצד הצדיק והבינוני נוהגים.', 'Normal')),
    ], 'tanya.docx'),
    'tanya', 0.9,
  );
  // --- Machzor (machzor + selichot → 2 strong) ---
  expectRecipe(
    'Machzor (Rosh Hashanah)',
    await decideDocx([
      para('מחזור — ראש השנה', 'Title'),
      para('תפילת שחרית של ראש השנה', 'Heading 1'),
      ...repeat(3, () => para('אדון עולם אשר מלך בטרם כל יציר נברא, לעת נעשה בחפצו כֹל.', 'Normal')),
      ...repeat(2, () => para('סליחות: עננו ה׳ עננו, כי בצרה גדולה אנחנו.', 'Normal')),
    ], 'machzor.docx'),
    'machzor', 0.9,
  );
  // --- Siddur, nusach variant (nusach ashkenaz → siddur, same geometry, content order differs) ---
  expectRecipe(
    'Siddur (nusach Ashkenaz)',
    await decideDocx([
      para('סידור — נוסח אשכנז', 'Title'),
      para('תפילת שחרית', 'Heading 1'),
      ...repeat(4, () => para('אדון עולם אשר מלך בטרם כל יציר נברא, לעת נעשה בחפצו כֹל אזי מלך שמו נקרא.', 'Normal')),
      para('מנחה: תפילת אחר הצהרים הנאמרת בכל יום.', 'Normal'),
    ], 'siddur.docx'),
    'siddur', 0.85,
  );

  console.log('== §2 — weak hints alone do NOT decide ==');
  // A doc that only says "mishnah" (no commentary pattern, no
  // Mishnah structure) must NOT pick mishnah-classic — it falls back.
  {
    const info = await decideDocx([
      para('משנה', 'Title'),
      ...repeat(3, () => para('זהו חיבור קצר על המשנה ועל דרכי לימודה, בלי פירוש צמוד ובלי מפרשים.', 'Normal')),
    ], 'mishnah-only.docx');
    check('bare "mishnah" does NOT pick mishnah-classic', info.decision.isFallback === true && info.decision.recipeId === 'single-column', info.decision.lineEn);
  }
  // Bare 'tur' (no siman) → fallback, not tur.
  {
    const info = await decideDocx([
      para('טור', 'Title'),
      ...repeat(3, () => para('חיבור קצר על הטור ועל סדרו, בלי סימנים ובלי מפרשים.', 'Normal')),
    ], 'tur-only.docx');
    check('bare "tur" does NOT pick tur', info.decision.isFallback === true && info.decision.recipeId === 'single-column', info.decision.lineEn);
  }
  // Bare 'rosh hashanah' (no prayer markers) → fallback, not machzor.
  {
    const info = await decideDocx([
      para('Rosh Hashanah', 'Title'),
      ...repeat(3, () => para('חיבור קצר על ראש השנה ועל מנהגיו.', 'Normal')),
    ], 'rosh-hashanah-only.docx');
    check('bare "rosh hashanah" does NOT pick machzor', info.decision.isFallback === true && info.decision.recipeId === 'single-column', info.decision.lineEn);
  }
  // Bare 'chumash' (no verse, no Targum/Rashi) → fallback, not chumash.
  {
    const info = await decideDocx([
      para('חומש', 'Title'),
      ...repeat(3, () => para('חיבור קצר על החומש ועל סדר הפרשיות, בלי פסוקים ובלי מפרשים.', 'Normal')),
    ], 'chumash-only.docx');
    check('bare "chumash" does NOT pick chumash', info.decision.isFallback === true && info.decision.recipeId === 'single-column', info.decision.lineEn);
  }
  // Bare 'shulchan aruch' (no siman, no commentary) → fallback.
  {
    const info = await decideDocx([
      para('שולחן ערוך', 'Title'),
      ...repeat(3, () => para('חיבור קצר על השולחן ערוך ועל סדרו, בלי סימנים ובלי מפרשים.', 'Normal')),
    ], 'sa-only.docx');
    check('bare "shulchan aruch" does NOT pick shulchan-aruch', info.decision.isFallback === true && info.decision.recipeId === 'single-column', info.decision.lineEn);
  }
  // Publisher name alone (no Gemara pattern) → NOT a Shas variant.
  {
    const info = await decideDocx([
      para('Oz VeHadar', 'Title'),
      ...repeat(3, () => para('חיבור קצר על הוצאת עוז והדר ועל מהדורותיה.', 'Normal')),
    ], 'oz-vehadar-only.docx');
    check('publisher name alone does NOT pick a Shas variant', info.decision.isFallback === true && !info.decision.recipeId.startsWith('shas-'), info.decision.lineEn);
  }
  // Single weak + role pattern → 0.7–0.8 (NOT high confidence):
  // Mishnah text with structure but no commentary marker.
  {
    const info = await decideDocx([
      para('משנה', 'Title'),
      ...repeat(3, () => para(MISHNA, 'Mishna')),
    ], 'mishnah-weak.docx');
    const d = info.decision;
    check(
      'weak "mishnah" + Mishnah structure picks mishnah-classic at 0.7–0.8, not high confidence',
      d.recipeId === 'mishnah-classic' && !d.isFallback && d.confidence >= 0.7 && d.confidence <= 0.8,
      d.lineEn,
    );
  }
  // Weak 'tur' + siman structure → tur at 0.7–0.8. (No commentary
  // units: a Bach unit would add the second role pattern
  // 'siman-commentaries' and lift the confidence to 0.85 — the
  // single-pattern band is what this check pins.)
  {
    const info = await decideDocx([
      para('הטור — אורח חיים', 'Title'),
      para('סימן א: יתגבר כארי לעמוד בבוקר לעבודת בוראו.', 'Heading 2'),
      ...repeat(3, () => para('דין הטור בענין זה, כפי שכתבו הראשונים והאחרונים.', 'Normal')),
    ], 'tur-weak.docx');
    const d = info.decision;
    check(
      'weak "tur" + siman structure picks tur at 0.7–0.8',
      d.recipeId === 'tur' && !d.isFallback && d.confidence >= 0.7 && d.confidence <= 0.8,
      d.lineEn,
    );
  }
  // Weak 'chumash' + verse (no Targum) → chumash at 0.7–0.8.
  {
    const info = await decideDocx([
      para('חומש — שמות', 'Title'),
      ...repeat(3, () => para(VERSE)),
      ...repeat(3, () => para('בראשית בשביל התורה שנקראת ראשית פירוש קצר על הפסוק.', 'Rashi')),
    ], 'chumash-weak.docx');
    const d = info.decision;
    check(
      'weak "chumash" + verse picks chumash at 0.7–0.8',
      d.recipeId === 'chumash' && !d.isFallback && d.confidence >= 0.7 && d.confidence <= 0.8,
      d.lineEn,
    );
  }

  console.log('== §3 — matcher unit checks (spans + prefix guards) ==');
  const signalKeys = (text: string): string[] => matchGenreSignals(text).map(s => s.key);
  check('"משנה תורה" is mishneh-torah strong, NOT a weak "mishnah"', (() => {
    const keys = signalKeys('משנה תורה');
    return keys.includes('mishneh-torah') && !keys.includes('mishnah');
  })(), signalKeys('משנה תורה').join(', '));
  check('"קיצור שולחן ערוך" is kitzur strong, NOT weak "shulchan aruch" or "kitzur"', (() => {
    const keys = signalKeys('קיצור שולחן ערוך');
    return keys.includes('kitzur-shulchan-aruch') && !keys.includes('shulchan-aruch') && !keys.includes('kitzur');
  })(), signalKeys('קיצור שולחן ערוך').join(', '));
  check('"בטור אחד" does NOT match the weak "tur" hint (prefix guard)', !signalKeys('בטור אחד').includes('tur'), signalKeys('בטור אחד').join(', ') || '(none)');
  check('"הטור" DOES match the weak "tur" hint', signalKeys('הטור').includes('tur'), signalKeys('הטור').join(', '));
  check('"משנה ברורה" is MB strong, NOT a weak "mishnah"', (() => {
    const keys = signalKeys('משנה ברורה');
    return keys.includes('mishnah-berurah') && !keys.includes('mishnah');
  })(), signalKeys('משנה ברורה').join(', '));
  check('"מדרש רבה" counts as ONE strong signal, not two', signalKeys('מדרש רבה').length === 1 && signalKeys('מדרש רבה')[0] === 'midrash-rabbah', signalKeys('מדרש רבה').join(', '));
  check('"Oz VeHadar" matches the oz-vehadar signal', signalKeys('Oz VeHadar').includes('oz-vehadar'), signalKeys('Oz VeHadar').join(', '));

  console.log('== §4 — suggestRecipe direct checks (incl. v0.9.0 Part A §D) ==');
  function expectSuggest(name: string, c: DocumentClassification, recipeId: string, minConfidence: number, fallback: boolean): void {
    const s = suggestRecipe(c);
    check(
      `${name} → ${recipeId}`,
      s.recipeId === recipeId && s.confidence >= minConfidence && s.fallback === fallback,
      `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback} (${s.reasons.join(' ')})`,
    );
  }
  expectSuggest(
    'Vilna-like',
    { roles: { main_source: 5, primary_comment: 4, secondary_comment: 4, tertiary_comment: 2 }, languages: ['he'], hasDibbur: true, commentaryCount: 3, isYiddish: false, hasFootnotes: false },
    'talmud-bavli', 0.9, false,
  );
  expectSuggest(
    'Mikraot-like',
    { roles: { verse: 8, primary_comment: 3, secondary_comment: 3, tertiary_comment: 3 }, languages: ['he'], hasDibbur: false, commentaryCount: 5, isYiddish: false, hasFootnotes: false },
    'mikraot-gedolot', 0.9, false,
  );
  expectSuggest(
    'prose',
    { roles: { regular_paragraph: 10, main_source: 2 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false },
    'machon-edition', 0.7, false,
  );
  expectSuggest(
    'siddur-like',
    { genreHint: 'siddur mincha', roles: { regular_paragraph: 8 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false },
    'siddur', 0.9, false,
  );
  expectSuggest(
    'Shulchan-Aruch-like',
    { genreHint: 'shulchan aruch', roles: { main_source: 4, siman: 3, seif: 6, primary_comment: 2 }, languages: ['he'], hasDibbur: false, commentaryCount: 3, isYiddish: false, hasFootnotes: false },
    'shulchan-aruch', 0.85, false,
  );
  expectSuggest(
    'Yiddish',
    { roles: { main_source: 3, primary_comment: 3 }, languages: ['yi', 'he'], hasDibbur: false, commentaryCount: 1, isYiddish: true, hasFootnotes: false },
    'yiddish-sefer', 0.9, false,
  );
  {
    const s = suggestRecipe({ roles: {}, languages: [], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false });
    check('unknown → low-confidence fallback', s.fallback === true && s.confidence < 0.5, `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback}`);
    const s2 = suggestRecipe({ roles: { main_source: 2, primary_comment: 1, secondary_comment: 1 }, languages: ['he'], hasDibbur: false, commentaryCount: 4, isYiddish: false, hasFootnotes: false });
    check('unknown commentary-heavy → two-column fallback', s2.fallback === true && s2.recipeId === 'shulchan-aruch', `got ${s2.recipeId} conf=${s2.confidence}`);
  }
  // Signal-based suggestRecipe checks.
  const ozSignal = { key: 'oz-vehadar', recipeId: 'shas-oz-vehadar', strength: 'strong' as const, label: 'Oz VeHadar', labelHe: 'עוז והדר', hint: 'oz vehadar', source: 'title' as const };
  expectSuggest(
    'publisher signal + Gemara flanks → shas-oz-vehadar',
    { roles: { main_source: 5, primary_comment: 4, secondary_comment: 4 }, languages: ['he'], hasDibbur: true, commentaryCount: 3, isYiddish: false, hasFootnotes: false, signals: [ozSignal], rolePatterns: ['gemara-flanks'] },
    'shas-oz-vehadar', 0.9, false,
  );
  {
    const s = suggestRecipe({ roles: { regular_paragraph: 5 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false, signals: [ozSignal], rolePatterns: [] });
    // Plain prose is legitimately a machon-edition pick (v0.9.0) —
    // the point is only that no Shas variant is chosen.
    check('publisher signal WITHOUT Gemara pattern → NOT a Shas variant', !s.recipeId.startsWith('shas-'), `got ${s.recipeId} conf=${s.confidence} fallback=${s.fallback}`);
  }
  {
    const s = suggestRecipe({ roles: {}, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false, signals: [{ key: 'mishnah', recipeId: 'mishnah-classic', strength: 'weak' as const, label: 'Mishnah', labelHe: 'משנה', hint: 'mishnah', source: 'title' as const }], rolePatterns: [] });
    check('weak "mishnah" signal alone → fallback, not mishnah-classic', s.fallback === true && s.recipeId !== 'mishnah-classic', `got ${s.recipeId} conf=${s.confidence}`);
  }
  expectSuggest(
    'weak "mishnah" + mishnah-structure → mishnah-classic at 0.75',
    { roles: { main_source: 3 }, languages: ['he'], hasDibbur: false, commentaryCount: 0, isYiddish: false, hasFootnotes: false, signals: [{ key: 'mishnah', recipeId: 'mishnah-classic', strength: 'weak' as const, label: 'Mishnah', labelHe: 'משנה', hint: 'mishnah', source: 'title' as const }], rolePatterns: ['mishnah-structure'] },
    'mishnah-classic', 0.75, false,
  );
  // Specificity: mishnah-berurah (rank 2) beats yerushalmi (rank 3)
  // when both have strong signals.
  expectSuggest(
    'MB signal beats Yerushalmi signal (specificity order)',
    { roles: { main_source: 3 }, languages: ['he'], hasDibbur: false, commentaryCount: 2, isYiddish: false, hasFootnotes: false, signals: [
      { key: 'yerushalmi', recipeId: 'yerushalmi', strength: 'strong' as const, label: 'Yerushalmi', labelHe: 'ירושלמי', hint: 'yerushalmi', source: 'title' as const },
      { key: 'mishnah-berurah', recipeId: 'mishnah-berurah', strength: 'strong' as const, label: 'Mishnah Berurah', labelHe: 'משנה ברורה', hint: 'mishnah berurah', source: 'title' as const },
    ], rolePatterns: [] },
    'mishnah-berurah', 0.85, false,
  );

  console.log('== §5 — old genres still classify correctly (v0.9.0 Part C §1/§4) ==');
  const vilna = await decideDocx(vilnaAnatomyParas('Heading 1', 'מסכת ברכות — פרק ראשון'), 'berakhot.docx');
  check('Vilna-like docx auto-selects vilna-shas', vilna.decision.recipeId === 'vilna-shas', vilna.decision.lineEn);
  check('Vilna decision is confident, not a fallback', !vilna.decision.isFallback && vilna.decision.confidence >= 0.5, `confidence ${vilna.decision.confidence}`);
  const mikraot = await decideDocx([
    para('בראשית פרק א', 'Heading 1'),
    ...repeat(8, () => para(VERSE)),
    ...repeat(5, () => para('אונקלוס: בראשית ברא אלהים ית שמיא וית ארעא.', 'Onkelos')),
    ...repeat(5, () => para('בראשית בשביל התורה שנקראת ראשית פירוש קצר על הפסוק.', 'Rashi')),
    ...repeat(3, () => para('אבן עזרא: בראשית יש מפרשים שהוא סמוך.', 'Ibn Ezra')),
    ...repeat(3, () => para('רמב״ן: בראשית ברא אלהים סוד גדול.', 'Ramban')),
    ...repeat(3, () => para('ספורנו: בראשית ברא את השמים תחלה.', 'Sforno')),
  ], 'bereishit.docx');
  check('Mikraot-like docx auto-selects mikraot-gedolot (5 commentators → Mikraot, not Chumash)', mikraot.decision.recipeId === 'mikraot-gedolot', mikraot.decision.lineEn);
  check('Mikraot has 5 distinct commentators', mikraot.classification.commentaryCount === 5, mikraot.classification.commentaryAuthors.join(', '));
  const responsa = await decideDocx([
    para('סימן א׳', 'Heading 2'),
    para('שאלה: ראובן שאל אם מותר לטלטל בשבת במקום שיש עירוב.', 'Normal'),
    para('שאלה: ועוד שאל בענין ברכה על פירות האילן.', 'Normal'),
    para('תשובה: נראה להתיר, וראיה מדברי הראשונים שכתבו כן.', 'Normal'),
    para('תשובה: ולענין השאלה השניה יש להחמיר.', 'Normal'),
  ], 'shut.docx');
  check('Responsa-like docx auto-selects responsa', responsa.decision.recipeId === 'responsa', responsa.decision.lineEn);
  const drush = await decideDocx([
    para('דרוש חסידי על פרשת בראשית', 'Heading 1'),
    ...repeat(6, () => para('דרוש: בענין החסידות והעבודה שבלב, אמר הבעל שם טוב שהאדם צריך לעבוד את הבורא בשמחה ובדבקות.', 'Normal')),
  ], 'drush.docx');
  check('Chassidic Drush-like docx auto-selects chassidic-drush', drush.decision.recipeId === 'chassidic-drush', drush.decision.lineEn);
  const yiddish = await decideDocx([...repeat(6, () => para(YIDDISH, 'Normal'))], 'yiddish.docx');
  check('Yiddish docx auto-selects yiddish-sefer', yiddish.decision.recipeId === 'yiddish-sefer', yiddish.decision.lineEn);
  const tzenerene = await decideDocx([
    para('פרשת בראשית', 'Tzenerene Heading'),
    ...repeat(4, () => para(YIDDISH, 'Tzenerene')),
  ], 'tzenerene.docx');
  check('Tzenerene docx auto-selects tzenerene', tzenerene.decision.recipeId === 'tzenerene', tzenerene.decision.lineEn);
  const prose = await decideDocx([
    para('הקדמה', 'Heading 1'),
    ...repeat(4, () => para('זהו טקסט פרוזה רגיל על נושא כללי, בלי שום סימן של גמרא או מפרשים או סימנים הלכתיים.', 'Normal')),
  ], 'prose.docx');
  check('Plain prose falls back to single-column', prose.decision.isFallback === true && prose.decision.recipeId === 'single-column', prose.decision.lineEn);
  const genericUnits: ContentUnit[] = [
    { id: 'g-src', role: 'main_source', rawText: 'טקסט מקור ארוך. '.repeat(30), styleName: 'Normal', order: 1, hierarchyLevel: 2 },
    { id: 'g-c1', role: 'primary_comment', rawText: 'פירוש כללי א. '.repeat(30), styleName: 'Commentary', order: 2, hierarchyLevel: 3 },
    { id: 'g-c2', role: 'primary_comment', rawText: 'פירוש כללי ב. '.repeat(30), styleName: 'Commentary', order: 3, hierarchyLevel: 3 },
    { id: 'g-c3', role: 'secondary_comment', rawText: 'פירוש כללי ג. '.repeat(30), styleName: 'Commentary', order: 4, hierarchyLevel: 3 },
    { id: 'g-c4', role: 'secondary_comment', rawText: 'פירוש כללי ד. '.repeat(30), styleName: 'Commentary', order: 5, hierarchyLevel: 3 },
  ];
  const genericInfo = classifyForImport(genericUnits, []);
  check('Generic commentary-heavy text falls back to two-column (not Vilna)', genericInfo.decision.isFallback === true && genericInfo.decision.recipeId === 'two-column', genericInfo.decision.lineEn);

  console.log('== §6 — per-genre typography is applied where the engine can ==');
  type RoleStyles = { paragraph?: { firstLineIndentPt?: number; hangingIndentPt?: number }; character?: { wordSpacingRatio?: number; trackingEm?: number } };
  const roleStyles = (s: ReturnType<typeof DesignSettingsEngine.createDefaultSettings>, role: string): RoleStyles | undefined =>
    (s.projectRoleStyles as unknown as Record<string, RoleStyles | undefined>)[role];
  const paraOf = (s: ReturnType<typeof DesignSettingsEngine.createDefaultSettings>, role: string) => roleStyles(s, role)?.paragraph;
  const charOf = (s: ReturnType<typeof DesignSettingsEngine.createDefaultSettings>, role: string) => roleStyles(s, role)?.character;

  const mbSettings = applyRecipeToSettingsById('mishnah-berurah', settings);
  check('MB: dibbur bold ON (Biur Halacha ד״ה)', mbSettings.ravText.dibburHamatchilBold === true);
  check('MB: commentary second-line indent (hanging 12)', paraOf(mbSettings, 'secondary_comment')?.hangingIndentPt === 12, `hanging=${paraOf(mbSettings, 'secondary_comment')?.hangingIndentPt}`);
  check('MB: main text no indent', paraOf(mbSettings, 'main_source')?.firstLineIndentPt === 0 && paraOf(mbSettings, 'main_source')?.hangingIndentPt === 0);
  check('MB: kashya justification (wordSpacingRatio 1.15)', charOf(mbSettings, 'main_source')?.wordSpacingRatio === 1.15, `ratio=${charOf(mbSettings, 'main_source')?.wordSpacingRatio}`);
  check('MB: Hebrew-letter folio, no daf prefix', mbSettings.pageElements.pageNumberStyle === 'hebrew' && mbSettings.pageElements.showDafPrefix === false);

  const rambamSettings = applyRecipeToSettingsById('mishneh-torah', settings);
  check('Rambam: dibbur bold explicitly OFF (Raavad glosses have no dibbur)', rambamSettings.ravText.dibburHamatchilBold === false);
  check('Rambam: commentary second-line indent', paraOf(rambamSettings, 'primary_comment')?.hangingIndentPt === 12);
  check('Rambam: main text no indent', paraOf(rambamSettings, 'main_source')?.firstLineIndentPt === 0 && paraOf(rambamSettings, 'main_source')?.hangingIndentPt === 0);

  const mishnahSettings = applyRecipeToSettingsById('mishnah-classic', settings);
  check('Mishnah: dibbur bold OFF (no dibbur on a Mishnah page)', mishnahSettings.ravText.dibburHamatchilBold === false);
  check('Mishnah: Bartenura second-line indent', paraOf(mishnahSettings, 'primary_comment')?.hangingIndentPt === 12);

  const mussarSettings = applyRecipeToSettingsById('mussar', settings);
  check('Mussar: first-line indent 12', paraOf(mussarSettings, 'main_source')?.firstLineIndentPt === 12, `firstLine=${paraOf(mussarSettings, 'main_source')?.firstLineIndentPt}`);
  check('Mussar: kashya justification', charOf(mussarSettings, 'main_source')?.wordSpacingRatio === 1.15);

  const kitzurSettings = applyRecipeToSettingsById('kitzur-shulchan-aruch', settings);
  check('Kitzur: first-line indent 12', paraOf(kitzurSettings, 'main_source')?.firstLineIndentPt === 12);
  const aruchSettings = applyRecipeToSettingsById('aruch-hashulchan', settings);
  check('Aruch HaShulchan: first-line indent 12', paraOf(aruchSettings, 'main_source')?.firstLineIndentPt === 12);
  const responsaSettings = applyRecipeToSettingsById('responsa', settings);
  check('Responsa (old recipe): first-line indent 12', paraOf(responsaSettings, 'main_source')?.firstLineIndentPt === 12);

  const machzorSettings = applyRecipeToSettingsById('machzor', settings);
  check('Machzor: no indents at all', paraOf(machzorSettings, 'main_source')?.firstLineIndentPt === 0 && paraOf(machzorSettings, 'main_source')?.hangingIndentPt === 0);
  check('Machzor: folio numbers at the outer top corners', machzorSettings.pageElements.pageNumberStyle === 'numbers' && machzorSettings.pageElements.folioNumberPosition === 'top_outside', `style=${machzorSettings.pageElements.pageNumberStyle} pos=${machzorSettings.pageElements.folioNumberPosition}`);

  const machonSettings = applyRecipeToSettingsById('machon-edition', settings);
  check('Machon (modern): tracking, NOT kashya', charOf(machonSettings, 'main_source')?.trackingEm === 0.02 && charOf(machonSettings, 'main_source')?.wordSpacingRatio === 1, `tracking=${charOf(machonSettings, 'main_source')?.trackingEm} ratio=${charOf(machonSettings, 'main_source')?.wordSpacingRatio}`);

  const ozSettings = applyRecipeToSettingsById('shas-oz-vehadar', settings);
  check('Oz VeHadar (recipe not added yet): typography still applies, no crash', ozSettings.ravText.dibburHamatchilBold === true && paraOf(ozSettings, 'main_source')?.hangingIndentPt === 12, `dibbur=${ozSettings.ravText.dibburHamatchilBold} hanging=${paraOf(ozSettings, 'main_source')?.hangingIndentPt}`);
  check('Oz VeHadar: daf-amud folio (Hebrew + daf prefix)', ozSettings.pageElements.pageNumberStyle === 'hebrew' && ozSettings.pageElements.showDafPrefix === true);

  const vilnaSettings = applyRecipeToSettingsById('vilna-shas', settings);
  check('Vilna (v0.9.0 regression): custom_layout + dibbur bold', vilnaSettings.layout.layoutType === 'custom_layout' && vilnaSettings.ravText.dibburHamatchilBold === true, vilnaSettings.layout.layoutType);

  const unknownSettings = applyRecipeToSettingsById('no-such-recipe', settings);
  check('unknown recipe id returns settings unchanged (never guessed)', unknownSettings === settings);

  // End-to-end: a new-genre docx decision flows into the settings.
  {
    const docx = await buildDocx([
      para('משנה ברורה — אורח חיים', 'Title'),
      para('סימן א סעיף א: יהודי חייב להתחזק בעבודת הבורא.', 'Heading 2'),
      ...repeat(2, () => para('מ"ב: אסור להתעכב בתפילה, ויש להקדים לכתחילה ולהתפלל עם הציבור.', 'MB')),
      para('ביאור הלכה: ד״ה יתגבר — ענין ההתגברות הוא כנגד היצר הרע.', 'Biur Halacha'),
    ]);
    const imported = await DocxImporter.importDocx(docx, 'mishnah-berurah.docx');
    const applied = applyAutoLayout(imported.units, imported.links, settings, { fileName: 'mishnah-berurah.docx' });
    check(
      'applyAutoLayout end-to-end: MB docx → mishnah-berurah + MB typography',
      applied.decision.recipeId === 'mishnah-berurah' && applied.settings.ravText.dibburHamatchilBold === true,
      applied.decision.lineEn,
    );
  }

  console.log(`\nPart B smoke: ${passes} passed, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error('SMOKE CRASH:', err);
  process.exit(1);
});
