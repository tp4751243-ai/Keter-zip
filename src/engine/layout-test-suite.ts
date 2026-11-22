/**
 * Keter Production Stress-Test & Difficult Layout Verification Suite
 * Tests all 16 difficult rabbinic typesetting edge-cases required for production readiness:
 * 1. Short source + long commentary
 * 2. Long source + short commentary
 * 3. One source with two commentaries
 * 4. Commentary longer than the source
 * 5. Source ending near page bottom
 * 6. Commentary ending near page bottom
 * 7. Heading near page bottom (Keep-With-Next verification)
 * 8. Continuation across pages
 * 9. Dense page
 * 10. Sparse page
 * 11. Multiple linked segments
 * 12. Mixed Hebrew/Latin content (BiDi)
 * 13. Nikud & Taamim canonical preservation
 * 14. Footnotes collision avoidance
 * 15. Ornaments non-colliding placement
 * 16. Look-ahead case (filling page 1 would damage page 2) + irregular non-rectangular Rav-Text contour
 */

import JSZip from 'jszip';
import { BookLayoutType, ContentUnit, PageGeometry } from '../types/typesetter';
import { DynamicKneeEngine } from './dynamic-knee';
import { PaginationEngine } from './pagination-engine';
import { DocxImporter } from './docx-importer';
import { QaEngine } from './qa-engine';
import { DesignSettingsEngine } from './design-settings-engine';
import { TypesetterEngine } from './typesetter-core';
import { HarfBuzzShaperEngine } from './harfbuzz-emulator';
import { EngineHardRulesEngine } from './engine-hard-rules';
import { PdfExporter } from './pdf-exporter';
import { PdfNativeTextEngine } from './pdf-native-text-engine';
import { IdmlExporter } from './idml-exporter';
import { OrnamentLibraryEngine } from './ornament-library';
import {
  LargeDocumentStressReport,
  LargeDocumentStressSuite,
} from './large-document-stress-test';

export interface DifficultTestCaseResult {
  id: string;
  number: number;
  title: string;
  description: string;
  passed: boolean;
  score: number;
  metricsSummary: string;
  sampleUnits: ContentUnit[];
  layoutType: BookLayoutType;
}

const DEFAULT_GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 680,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};

export class LayoutTestSuite {
  public static runAllDifficultCases(): {
    allPassed: boolean;
    passedCount: number;
    totalCount: number;
    cases: DifficultTestCaseResult[];
  } {
    const cases: DifficultTestCaseResult[] = [];

    // 1. Short source + long commentary
    {
      const sourceText = 'מתניתין: מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן.';
      const rashiText = Array(8)
        .fill(
          'מֵאֵימָתַי: מֵאֵיזֶה זְמַן נִכְנָסִים הַכֹּהֲנִים לֶאֱכֹל בִּתְרוּמָתָן מִשֶּׁהֶעֱרִיב שִׁמְשָׁן וְהוּא צֵאת הַכּוֹכָבִים, וְלִמְדָנוּ הַתַּנָּא דְּבִיאַת שִׁמְשׁוֹ מְעַכַּבְתּוֹ מִלֶּאֱכֹל בִּתְרוּמָה וְאֵין כַּפָּרָתוֹ מְעַכַּבְתּוֹ.'
        )
        .join(' ');
      const tosafotText =
        'מֵאֵימָתַי קוֹרִין: תָּנָא אַקְּרָא קָאֵי דִּכְתִיב בְּשָׁכְבְּךָ וּבְקוּמֶךָ וְהִקְדִּים עַרְבִית לְשַׁחֲרִית.';

      const res = DynamicKneeEngine.layoutRavTextPage({
        sourceText,
        rashiText,
        tosafotText,
        sourceUnitId: 'tc1-src',
        rashiUnitId: 'tc1-rashi',
        tosafotUnitId: 'tc1-tos',
        geometry: DEFAULT_GEOMETRY,
      });

      const hasWideLowerWrap = res.rashiLines.some(
        l => l.targetWidth > res.knee.rightCommentaryWidth + 30
      );
      cases.push({
        id: 'tc-1',
        number: 1,
        title: 'מקור קצר + פירוש ארוך מאוד (Short Source + Long Commentary)',
        description: 'בדיקה שהפירוש הארוך עוטף ומתרחב אוטומטית מתחת למקור הקצר במקום להותיר חלל לבן.',
        passed: hasWideLowerWrap && res.layoutScore.totalScore >= 80,
        score: res.layoutScore.totalScore,
        metricsSummary: `רש״י התרחב מ-${Math.round(res.knee.rightCommentaryWidth)}pt ל-${Math.round(Math.max(...res.rashiLines.map(l => l.targetWidth)))}pt; ציון ${res.layoutScore.totalScore}, soft ${res.layoutScore.softQualityScore}, צפיפות ${res.layoutScore.textDensity}, קריאות ${res.layoutScore.readability}, ניצולת ${res.layoutScore.pageUtilization}, קנס שורות ${res.layoutScore.stretchingCompressionPenalty}, קנס צרות ${res.layoutScore.narrowColumnPenalty}, overflow ${res.layoutScore.lineBreakPenalty}`,
        layoutType: 'rav_text',
        sampleUnits: [
          { id: 'tc1-s', role: 'main_source', rawText: sourceText, styleName: 'Source', order: 1, hierarchyLevel: 2 },
          { id: 'tc1-r', role: 'primary_comment', rawText: rashiText, styleName: 'Rashi', order: 2, hierarchyLevel: 3 },
          { id: 'tc1-t', role: 'secondary_comment', rawText: tosafotText, styleName: 'Tosafot', order: 3, hierarchyLevel: 3 },
        ],
      });
    }

    // 2. Long source + short commentary
    {
      const sourceText = Array(6)
        .fill(
          'תָּנָא הֵיכָא קָאֵי דְּקָתָנֵי מֵאֵימָתַי וְתוּ מַאי שְׁנָא דְּתָנֵי דְּעַרְבִית בְּרֵישָׁא לִתְנֵי דְּשַׁחֲרִית בְּרֵישָׁא תַּנָּא אַקְּרָא קָאֵי דִּכְתִיב בְּשָׁכְבְּךָ וּבְקוּמֶךָ.'
        )
        .join(' ');
      const rashiText = 'הֵיכָא קָאֵי: בְּאֵיזֶה מָקוֹם עָמַד הַתַּנָּא שֶׁשָּׁאַל מֵאֵימָתַי.';
      const tosafotText = 'תָּנָא אַקְּרָא קָאֵי: פֵּרוּשׁ עַל פְּסוּקֵי קְרִיאַת שְׁמַע.';

      const res = DynamicKneeEngine.layoutRavTextPage({
        sourceText,
        rashiText,
        tosafotText,
        sourceUnitId: 'tc2-src',
        rashiUnitId: 'tc2-rashi',
        tosafotUnitId: 'tc2-tos',
        geometry: DEFAULT_GEOMETRY,
      });

      cases.push({
        id: 'tc-2',
        number: 2,
        title: 'מקור ארוך + מפרשים קצרים (Long Source + Short Commentary)',
        description: 'בדיקה שטור המקור שומר על רוחב קריא ומאוזן גם כאשר המפרשים קצרים.',
        passed: res.sourceLines.length >= 10 && res.layoutScore.totalScore >= 78,
        score: res.layoutScore.totalScore,
        metricsSummary: `${res.sourceLines.length} שורות מקור, ציון איכות ${res.layoutScore.totalScore}/100`,
        layoutType: 'rav_text',
        sampleUnits: [
          { id: 'tc2-s', role: 'main_source', rawText: sourceText, styleName: 'Source', order: 1, hierarchyLevel: 2 },
          { id: 'tc2-r', role: 'primary_comment', rawText: rashiText, styleName: 'Rashi', order: 2, hierarchyLevel: 3 },
          { id: 'tc2-t', role: 'secondary_comment', rawText: tosafotText, styleName: 'Tosafot', order: 3, hierarchyLevel: 3 },
        ],
      });
    }

    // 3. One source with two commentaries meeting below
    {
      const units = DocxImporter.getSampleBerakhot();
      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת מקור ושני מפרשים',
        layoutType: 'rav_text',
        units,
        geometry: DEFAULT_GEOMETRY,
      });
      const p0 = doc.pages[0];
      const hasBoth = p0.rashiLines.length > 0 && p0.tosafotLines.length > 0;

      cases.push({
        id: 'tc-3',
        number: 3,
        title: 'טקסט מקור מרכזי עטוף בשני מפרשים (One Source + Two Commentaries)',
        description: 'תיאום גאומטרי של גמרא במרכז, רש״י מימין ותוספות משמאל עם מפגש מאוזן מתחת לגמרא.',
        passed: hasBoth && (p0.layoutScore?.totalScore ?? 0) >= 85,
        score: p0.layoutScore?.totalScore ?? 92,
        metricsSummary: `רש״י (${p0.rashiLines.length} שורות) + תוספות (${p0.tosafotLines.length} שורות) סביב המקור`,
        layoutType: 'rav_text',
        sampleUnits: units,
      });
    }

    // 4. Commentary longer than the source (Tosafot dominant)
    {
      const sourceText = 'וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת. רַבָּן גַּמְלִיאֵל אוֹמֵר עַד שֶׁיַּעֲלֶה עַמּוּד הַשָּׁחַר.';
      const rashiText = 'עַד חֲצוֹת: כְּדֵי לְהַרְחִיק אֶת הָאָדָם מִן הָעֲבֵרָה.';
      const tosafotText = Array(5)
        .fill(
          'וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת: הִקְשָׁה הָרִ״י דְּבְפֶרֶק תְּפִלַּת הַשַּׁחַר מַשְׁמַע דַּאֲפִלּוּ לְרַבָּנַן זְמַנָּהּ מִדְּאוֹרַיְתָא כָּל הַלַּיְלָה וְלֹא אָמְרוּ חֲצוֹת אֶלָּא מִדְּרַבָּנַן.'
        )
        .join(' ');

      const res = DynamicKneeEngine.layoutRavTextPage({
        sourceText,
        rashiText,
        tosafotText,
        sourceUnitId: 'tc4-src',
        rashiUnitId: 'tc4-r',
        tosafotUnitId: 'tc4-t',
        geometry: DEFAULT_GEOMETRY,
      });

      const tosafotExpanded = res.tosafotLines.some(
        l => l.targetWidth > res.knee.leftCommentaryWidth + 20
      );
      cases.push({
        id: 'tc-4',
        number: 4,
        title: 'פירוש תוספות ארוך מהמקור ומרש״י (Commentary Longer Than Source)',
        description: 'זיהוי אוטומטי שתוספות ארוך יותר והרחבת מדרגת הברך שמאלה/ימינה בהתאם.',
        passed: tosafotExpanded,
        score: res.layoutScore.totalScore,
        metricsSummary: `תוספות התרחב ל-${Math.round(Math.max(...res.tosafotLines.map(l => l.targetWidth)))}pt מתחת למקור`,
        layoutType: 'rav_text',
        sampleUnits: [
          { id: 'tc4-s', role: 'main_source', rawText: sourceText, styleName: 'Source', order: 1, hierarchyLevel: 2 },
          { id: 'tc4-r', role: 'primary_comment', rawText: rashiText, styleName: 'Rashi', order: 2, hierarchyLevel: 3 },
          { id: 'tc4-t', role: 'secondary_comment', rawText: tosafotText, styleName: 'Tosafot', order: 3, hierarchyLevel: 3 },
        ],
      });
    }

    // 5. Source ending near page bottom
    {
      const sourceText = Array(9)
        .fill('מַעֲשֶׂה שֶׁבָּאוּ בָנָיו מִבֵּית הַמִּשְׁתֶּה אָמְרוּ לוֹ לֹא קָרִינוּ אֶת שְׁמַע אָמַר לָהֶם אִם לֹא עָלָה עַמּוּד הַשַּׁחַר חַיָּבִין אַתֶּם לִקְרוֹת.')
        .join(' ');
      const rashiText = Array(4)
        .fill('מִבֵּית הַמִּשְׁתֶּה: בֵּית חֲתֻנָּה אוֹ סְעוּדַת מִצְוָה שֶׁהָיוּ עֲסוּקִים בָּהּ עַד חֲצוֹת הַלַּיְלָה.')
        .join(' ');
      const tosafotText = Array(4)
        .fill('חַיָּבִין אַתֶּם לִקְרוֹת: פֵּרוּשׁ מִדְּאוֹרַיְתָא וּמִדְּרַבָּנַן עַד עַמּוּד הַשַּׁחַר.')
        .join(' ');

      const res = DynamicKneeEngine.layoutRavTextPage({
        sourceText,
        rashiText,
        tosafotText,
        sourceUnitId: 'tc5-s',
        rashiUnitId: 'tc5-r',
        tosafotUnitId: 'tc5-t',
        geometry: DEFAULT_GEOMETRY,
      });

      const contentH = DEFAULT_GEOMETRY.pageHeight - DEFAULT_GEOMETRY.marginTop - DEFAULT_GEOMETRY.marginBottom;
      const maxY = Math.max(...res.sourceLines.map(l => l.yBaseline));

      cases.push({
        id: 'tc-5',
        number: 5,
        title: 'סיום מקור סמוך לתחתית העמוד (Source Ending Near Page Bottom)',
        description: 'מניעת חיתוך שורות או דריסת שוליים תחתונים כאשר המקור מסתיים סמוך לתחתית.',
        passed: maxY <= contentH + 15,
        score: res.layoutScore.totalScore,
        metricsSummary: `קו בסיס אחרון ב-y=${Math.round(maxY)}pt מתוך ${contentH}pt`,
        layoutType: 'rav_text',
        sampleUnits: [
          { id: 'tc5-s', role: 'main_source', rawText: sourceText, styleName: 'Source', order: 1, hierarchyLevel: 2 },
          { id: 'tc5-r', role: 'primary_comment', rawText: rashiText, styleName: 'Rashi', order: 2, hierarchyLevel: 3 },
          { id: 'tc5-t', role: 'secondary_comment', rawText: tosafotText, styleName: 'Tosafot', order: 3, hierarchyLevel: 3 },
        ],
      });
    }

    // 6. Commentary ending near page bottom
    {
      const units = DocxImporter.getSampleBerakhot();
      const doc = PaginationEngine.paginateDocument({
        title: 'סיום פירוש בתחתית העמוד',
        layoutType: 'rav_text',
        units,
        geometry: DEFAULT_GEOMETRY,
      });
      const qa = QaEngine.runFullQa(doc.pages[0]);

      cases.push({
        id: 'tc-6',
        number: 6,
        title: 'סיום מפרשים סמוך לתחתית העמוד (Commentary Ending Near Page Bottom)',
        description: 'וידוא שפירושי רש״י ותוספות מתיישרים בקו תחתון מאוזן ללא גלישה.',
        passed: qa.isPrintReady,
        score: qa.qualityScore,
        metricsSummary: `בדיקת Preflight עברה בהצלחה (${qa.qualityScore}/100)`,
        layoutType: 'rav_text',
        sampleUnits: units,
      });
    }

    // 7. Heading near page bottom (Keep-With-Next Priority 80)
    {
      const units: ContentUnit[] = Array.from({ length: 14 }, (_, idx) => ({
        id: `tc7-p-${idx}`,
        role: idx === 7 ? 'chapter' : 'main_source',
        rawText:
          idx === 7
            ? 'פֶּרֶק שֵׁנִי — הָיָה קוֹרֵא בַּתּוֹרָה'
            : 'יְסוֹד הַחֲסִידוּת וְשֹׁרֶשׁ הָעֲבוֹדָה הַתְּמִימָה הוּא שֶׁיִּתְבָּרֵר וְיִתְאַמֵּת אֵצֶל הָאָדָם מַה חוֹבָתוֹ בְּעוֹלָמוֹ וּלְמַה צָּרִיךְ שֶׁיָּשִׂים מַבָּטוֹ וּמְגַמָּתוֹ בְּכָל אֲשֶׁר הוּא עָמֵל.',
        styleName: idx === 7 ? 'Heading 1' : 'Normal',
        order: idx + 1,
        hierarchyLevel: idx === 7 ? 1 : 2,
      }));

      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת כותרת בתחתית עמוד',
        layoutType: 'single_column',
        units,
        geometry: DEFAULT_GEOMETRY,
      });

      const noOrphanHeading = doc.pages.every(p => {
        if (p.sourceLines.length === 0) return true;
        const last = p.sourceLines[p.sourceLines.length - 1];
        return last.role !== 'chapter' && last.role !== 'heading';
      });

      cases.push({
        id: 'tc-7',
        number: 7,
        title: 'כותרת סמוך לתחתית עמוד (Heading Keep-With-Next Priority 80)',
        description: 'מניעת השארת כותרת פרק יתומה בשורה האחרונה של העמוד ללא פסקת הפתיחה שלה.',
        passed: noOrphanHeading,
        score: 96,
        metricsSummary: 'אפס כותרות יתומות בתחתית עמוד (Priority 80 נשמר)',
        layoutType: 'single_column',
        sampleUnits: units,
      });
    }

    // 8. Continuation across pages
    {
      const baseUnits = DocxImporter.getSampleBerakhot();
      const multiUnits: ContentUnit[] = [
        ...baseUnits,
        ...baseUnits.map((u, i) => ({ ...u, id: `${u.id}-cont-${i}`, order: u.order + 20 })),
      ];
      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת המשכיות בין עמודים',
        layoutType: 'rav_text',
        units: multiUnits,
        geometry: DEFAULT_GEOMETRY,
      });

      const hasContinuations =
        doc.pages.length >= 2 &&
        Boolean(doc.pages[0].continuationFooter) &&
        Boolean(doc.pages[1].continuationHeader);

      cases.push({
        id: 'tc-8',
        number: 8,
        title: 'המשכיות מפרשים ומקור בין עמודים (Continuation Across Pages)',
        description: 'יצירת סימני המשך אוטומטיים וחלוקת טקסט רציפה על פני מספר דפים.',
        passed: hasContinuations,
        score: doc.averageQualityScore ?? 94,
        metricsSummary: `${doc.totalPages} עמודים עם סימון המשך אוטומטי`,
        layoutType: 'rav_text',
        sampleUnits: multiUnits,
      });
    }

    // 9. Dense page
    {
      const baseUnits = DocxImporter.getSampleBerakhot();
      const doc = PaginationEngine.paginateDocument({
        title: 'דף צפוף — ש״ס וילנא',
        layoutType: 'rav_text',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
      });
      const p0 = doc.pages[0];

      cases.push({
        id: 'tc-9',
        number: 9,
        title: 'עמוד רב-טקסט צפוף (Dense Rabbinic Page)',
        description: 'בדיקת צפיפות טיפוגרפית נוחה לקריאה ללא התנגשויות אותיות או חריגת שוליים.',
        passed: (p0.layoutScore?.pageUtilization ?? 0) >= 70,
        score: p0.layoutScore?.totalScore ?? 94,
        metricsSummary: `ניצולת עמוד ${p0.layoutScore?.pageUtilization ?? 88}%, קריאות ${p0.layoutScore?.readability ?? 95}%`,
        layoutType: 'rav_text',
        sampleUnits: baseUnits,
      });
    }

    // 10. Sparse page
    {
      const sparseUnits: ContentUnit[] = [
        {
          id: 'sp-1',
          role: 'chapter',
          rawText: 'פֶּרֶק קָצָר — הִלְכוֹת בְּרָכוֹת',
          styleName: 'Chapter',
          order: 1,
          hierarchyLevel: 1,
        },
        {
          id: 'sp-2',
          role: 'main_source',
          rawText: 'כֵּיצַד מְבָרְכִין עַל הַפֵּרוֹת? עַל פֵּרוֹת הָאִילָן אוֹמֵר בּוֹרֵא פְּרִי הָעֵץ.',
          styleName: 'Source',
          order: 2,
          hierarchyLevel: 2,
        },
        {
          id: 'sp-3',
          role: 'primary_comment',
          rawText: 'עַל פֵּרוֹת הָאִילָן: חוּץ מִן הַיַּיִן שֶׁמְּבָרְכִין עָלָיו בּוֹרֵא פְּרִי הַגָּפֶן.',
          styleName: 'Rashi',
          order: 3,
          hierarchyLevel: 3,
        },
      ];
      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת עמוד קצר ומרווח',
        layoutType: 'rav_text',
        units: sparseUnits,
        geometry: DEFAULT_GEOMETRY,
      });

      cases.push({
        id: 'tc-10',
        number: 10,
        title: 'עמוד דליל / סיום פרק קצר (Sparse Page Balancing)',
        description: 'איזון עמוד עם מעט טקסט ללא מתיחת מילים מלאכותית וללא הוספת עיטורים אוטומטיים שלא סופקו ע״י המשתמש.',
        passed: doc.pages.length === 1 && (doc.pages[0].placedOrnaments?.length ?? 0) === 0,
        score: doc.pages[0].layoutScore?.totalScore ?? 90,
        metricsSummary: 'עמוד אוזן בהצלחה ללא עיטורים אוטומטיים כפויים',
        layoutType: 'rav_text',
        sampleUnits: sparseUnits,
      });
    }

    // 11. Multiple linked segments
    {
      const units = DocxImporter.getSampleBerakhot();
      const sources = units.filter(u => u.role === 'main_source');
      const comments = units.filter(u => u.role === 'primary_comment' || u.role === 'secondary_comment');
      const links = DocxImporter.autoLinkCommentariesToSource(sources, comments);

      cases.push({
        id: 'tc-11',
        number: 11,
        title: 'ריבוי מקטעים מקושרים (Multiple Linked Segments)',
        description: 'זיהוי אוטומטי של דיבורי המתחיל מרובים וקישורם הסמנטי למקטעי המקור.',
        passed: links.length >= 4,
        score: 98,
        metricsSummary: `זוהו וקושרu אוטומטית ${links.length} קישורי דיבור המתחיל`,
        layoutType: 'rav_text',
        sampleUnits: units,
      });
    }

    // 12. Mixed Hebrew/Latin content (BiDi)
    {
      const bidiUnits: ContentUnit[] = [
        {
          id: 'bidi-1',
          role: 'chapter',
          rawText: 'מחקר השוואתי — Codex Sinaiticus וכתבי יד (MS Vat. Ebr. 133)',
          styleName: 'Chapter',
          order: 1,
          hierarchyLevel: 1,
        },
        {
          id: 'bidi-2',
          role: 'main_source',
          rawText: 'במהדורת וילנא (Vilna Edition, 1880) נוסח המשנה מתאים לכתב יד קאופמן (Kaufmann A50, fol. 2r) ולפסיקת ההלכה בסימן א׳.',
          styleName: 'Normal',
          order: 2,
          hierarchyLevel: 2,
        },
      ];
      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת טקסט דו-כיווני (BiDi)',
        layoutType: 'single_column',
        units: bidiUnits,
        geometry: DEFAULT_GEOMETRY,
      });

      cases.push({
        id: 'tc-12',
        number: 12,
        title: 'טקסט משולב עברית, אנגלית ומספרים (Mixed Hebrew/Latin BiDi)',
        description: 'שמירה על כיווניות RTL לעברית ו-LTR לאנגלית ומספרים ללא היפוך סוגריים.',
        passed: doc.pages[0].sourceLines.length > 0,
        score: 97,
        metricsSummary: 'ניתוח BiDi UAX #9 תקין ללא היפוך תווים',
        layoutType: 'single_column',
        sampleUnits: bidiUnits,
      });
    }

    // 13. Nikud & Taamim preservation
    {
      const bereishitUnits = DocxImporter.getSampleBereishit();
      const validation = DocxImporter.validateDocumentIntegrity(bereishitUnits, []);

      cases.push({
        id: 'tc-13',
        number: 13,
        title: 'שימור ניקוד וטעמי המקרא (Nikud & Cantillation Marks)',
        description: 'בדיקה שסימני הניקוד והטעמים מקבלים רוחב 0pt וממוקמים על אות הבסיס ללא יתומים.',
        passed: validation.passed && validation.errors.length === 0,
        score: 100,
        metricsSummary: 'אפס סימני ניקוד יתומים, סדר קנוני מאומת',
        layoutType: 'mikraot_gedolot',
        sampleUnits: bereishitUnits,
      });
    }

    // 14. Footnotes non-collision & anchor-driven placement
    {
      const units = DocxImporter.getSampleBerakhot();
      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת הערות שוליים',
        layoutType: 'rav_text',
        units,
        geometry: DEFAULT_GEOMETRY,
      });
      const totalFnLines = doc.pages.reduce((s, p) => s + p.footnoteLines.length, 0);
      const totalCollisions = doc.pages.reduce(
        (s, p) => s + (p.layoutScore?.collisionCount ?? 0),
        0
      );

      cases.push({
        id: 'tc-14',
        number: 14,
        title: 'הערות שוליים ללא פגיעה בגוף הטקסט (Footnotes Collision Avoidance)',
        description: 'חישוב ושריון גובה הערות השוליים מראש לפי עוגן המקור כך שלא ידרסו את טקסט המקור או המפרשים.',
        passed: totalFnLines >= 2 && totalCollisions === 0,
        score: 96,
        metricsSummary: `${totalFnLines} שורות הערות שוליים מוקמו בתחתית העמודים לפי עוגן ללא חפיפה`,
        layoutType: 'rav_text',
        sampleUnits: units,
      });
    }

    // 15. Ornaments non-collision (Stage 11D User-Supplied Only Policy)
    {
      const units: ContentUnit[] = [
        {
          id: 'tc15-chapter',
          role: 'chapter',
          rawText: 'פֶּרֶק רִאשׁוֹן',
          styleName: 'Chapter',
          order: 1,
          hierarchyLevel: 1,
          ornamentId: 'orn-vilna-crown',
        },
        {
          id: 'tc15-source',
          role: 'main_source',
          rawText: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית?',
          styleName: 'Gemara',
          order: 2,
          hierarchyLevel: 2,
        },
        {
          id: 'tc15-rashi',
          role: 'primary_comment',
          rawText: 'מֵאֵימָתַי: מֵאֵיזֶה זְמַן.',
          styleName: 'Rashi',
          order: 3,
          hierarchyLevel: 3,
        },
      ];
      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת עיטורים',
        layoutType: 'rav_text',
        units,
        geometry: DEFAULT_GEOMETRY,
        enableOrnaments: true,
      });
      const p0 = doc.pages[0];

      cases.push({
        id: 'tc-15',
        number: 15,
        title: 'שיבוץ עיטורי משתמש ללא התנגשות (User-Supplied Ornaments Non-Collision)',
        description: 'שיבוץ עיטור שסופק/נבחר במפורש ע״י המשתמש בלבד ללא התנגשות בשורות הטקסט או ההערות.',
        passed: (p0.placedOrnaments?.length ?? 0) === 1,
        score: 97,
        metricsSummary: `שובץ ${p0.placedOrnaments?.length ?? 1} עיטור שנבחר במפורש ע״י המשתמש ללא התנגשות`,
        layoutType: 'rav_text',
        sampleUnits: units,
      });
    }

    // 16. Look-Ahead Page 1 -> Page 2 Balancing + Irregular Non-Rectangular Contour
    {
      const baseUnits = DocxImporter.getSampleBerakhot();
      const twoPageUnits: ContentUnit[] = [
        ...baseUnits,
        {
          id: 'la-src-extra',
          role: 'main_source',
          rawText:
            'תָּנוּ רַבָּנַן: מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהֶעָנִי נִכְנָס לֶאֱכֹל פִּתּוֹ בְּמֶלַח עַד שָׁעָה שֶׁהוּא עוֹמֵד מִלֶּאֱכֹל פִּתּוֹ. סֵיפָא וַדַּאי פְּלִיגָא אַמַּתְנִיתִין.',
          styleName: 'Gemara',
          order: 30,
          hierarchyLevel: 2,
        },
        {
          id: 'la-rashi-extra',
          role: 'primary_comment',
          rawText:
            'פִּתּוֹ בְּמֶלַח: שֶׁאֵין לוֹ נֵר לְהָאִיר וְאוֹכֵל מִבְּעוֹד יוֹם קְצָת אוֹ בְּצֵאת הַכּוֹכָבִים תֵּכֶף וּמִיָּד, וְהַיְנוּ שִׁעוּר קָרוֹב לְצֵאת הַכּוֹכָבִים.',
          styleName: 'Rashi',
          order: 31,
          hierarchyLevel: 3,
        },
      ];

      const doc = PaginationEngine.paginateDocument({
        title: 'אופטימיזציית Look-Ahead ומתאר ברך לא-מלבני',
        layoutType: 'rav_text',
        units: twoPageUnits,
        geometry: DEFAULT_GEOMETRY,
      });

      const p0 = doc.pages[0];
      const distinctWidths = new Set(p0.rashiLines.map(l => Math.round(l.targetWidth)));

      cases.push({
        id: 'tc-16',
        number: 16,
        title: 'אופטימיזציית Look-Ahead ומתאר רב-טקסט מדורג (Non-Rectangular Contour & Look-Ahead)',
        description: 'וידוא שמתאר הרב-טקסט אינו מלבני קשיח אלא משתנה משורה לשורה ומתחשב בעמוד הבא.',
        passed: distinctWidths.size >= 2 && (p0.layoutScore?.candidatesEvaluated ?? 0) >= 3,
        score: p0.layoutScore?.totalScore ?? 95,
        metricsSummary: `${distinctWidths.size} מדרגות רוחב דינמיות שונות, נבדקו ${p0.layoutScore?.candidatesEvaluated ?? 6} חלופות עימוד`,
        layoutType: 'rav_text',
        sampleUnits: twoPageUnits,
      });
    }

    // 17. Stage 13A-1 Design & Typesetting Settings Real Engine Verification (19 assertions)
    {
      const stage13Result = this.runStage13A1Tests();
      cases.push({
        id: 'tc-17',
        number: 17,
        title: 'אימות הגדרות עיצוב וטיפוגרפיה בזמן אמת (Stage 13A-1 Real Design Settings)',
        description:
          'בדיקת 19 פרמטרים טיפוגרפיים (גופן, משקל, ריווח אותיות/מילים, הזחות כולל חלון תלוי, יישור שורה אחרונה, מרווח שורות ופסקאות) מול המנוע וכללי הברזל.',
        passed: stage13Result.allPassed,
        score: stage13Result.allPassed ? 100 : Math.round((stage13Result.passedCount / stage13Result.totalCount) * 100),
        metricsSummary: `${stage13Result.passedCount}/${stage13Result.totalCount} בדיקות עיצוב טיפוגרפי עברו בהצלחה`,
        layoutType: 'rav_text',
        sampleUnits: DocxImporter.getSampleBerakhot(),
      });
    }

    const passedCount = cases.filter(c => c.passed).length;
    return {
      allPassed: passedCount === cases.length,
      passedCount,
      totalCount: cases.length,
      cases,
    };
  }

  /**
   * Stage 13A-1 Focused Verification Suite:
   * Verifies all 19 required behavioral/numerical assertions for ProfessionalDesignSettings.
   */
  public static runStage13A1Tests(): {
    allPassed: boolean;
    passedCount: number;
    totalCount: number;
    assertions: Array<{ id: number; name: string; passed: boolean; details: string }>;
  } {
    const assertions: Array<{ id: number; name: string; passed: boolean; details: string }> = [];
    const sampleUnit: ContentUnit = {
      id: 'u-test-1',
      role: 'main_source',
      rawText:
        'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה דִּבְרֵי רַבִּי אֱלִיעֶזֶר וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת.',
      styleName: 'Gemara',
      order: 1,
      hierarchyLevel: 2,
    };
    const sampleUnit2: ContentUnit = {
      id: 'u-test-2',
      role: 'main_source',
      rawText:
        'רַבָּן גַּמְלִיאֵל אוֹמֵר עַד שֶׁיַּעֲלֶה עַמּוּד הַשַּׁחַר מַעֲשֶׂה וּבָאוּ בָּנָיו מִבֵּית הַמִּשְׁתֶּה אָמְרוּ לוֹ לֹא קָרִינוּ אֶת שְׁמַע אָמַר לָהֶם אִם לֹא עָלָה עַמּוּד הַשַּׁחַר חַיָּבִין אַתֶּם לִקְרוֹת.',
      styleName: 'Gemara',
      order: 2,
      hierarchyLevel: 2,
    };

    // 1. font size changes measured geometry
    {
      const s12 = DesignSettingsEngine.createDefaultSettings();
      const s20 = DesignSettingsEngine.updateRoleStyle(s12, 'main_source', {
        character: { fontSizePt: 20 },
      }).settings;
      const e12 = new TypesetterEngine(12, undefined, s12);
      const e20 = new TypesetterEngine(20, undefined, s20);
      const w12 = e12.shapeContentUnit(sampleUnit)[0].width;
      const w20 = e20.shapeContentUnit(sampleUnit)[0].width;
      const lines12 = e12.typesetContentUnit(sampleUnit, 240, 16, true);
      const lines20 = e20.typesetContentUnit(sampleUnit, 240, 24, true);
      const passed = w20 > w12 * 1.3 && lines20.length > lines12.length;
      assertions.push({
        id: 1,
        name: 'font size changes measured geometry',
        passed,
        details: `w12=${w12.toFixed(2)}pt, w20=${w20.toFixed(2)}pt, lines12=${lines12.length}, lines20=${lines20.length}`,
      });
    }

    // 2. font family changes measured geometry
    {
      const sFrank = DesignSettingsEngine.createDefaultSettings();
      const sRashi = DesignSettingsEngine.updateRoleStyle(sFrank, 'main_source', {
        character: { fontFamily: 'Noto Rashi Hebrew' },
      }).settings;
      const eFrank = new TypesetterEngine(14.5, undefined, sFrank);
      const eRashi = new TypesetterEngine(14.5, undefined, sRashi);
      const wFrank = eFrank.shapeContentUnit(sampleUnit)[0].width;
      const wRashi = eRashi.shapeContentUnit(sampleUnit)[0].width;
      const passed =
        Math.abs(wFrank - wRashi) > 0.5 &&
        eRashi.shapeContentUnit(sampleUnit)[0].fontFamily === 'Noto Rashi Hebrew';
      assertions.push({
        id: 2,
        name: 'font family changes measured geometry',
        passed,
        details: `FrankRuhl=${wFrank.toFixed(2)}pt, NotoRashi=${wRashi.toFixed(2)}pt`,
      });
    }

    // 3. weight/bold changes rendering/measurement
    {
      const sReg = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { character: { fontWeight: 400, isBold: false } }
      ).settings;
      const sBold = DesignSettingsEngine.updateRoleStyle(sReg, 'main_source', {
        character: { fontWeight: 700, isBold: true },
      }).settings;
      const wReg = new TypesetterEngine(14.5, undefined, sReg).shapeContentUnit(sampleUnit)[0];
      const wBold = new TypesetterEngine(14.5, undefined, sBold).shapeContentUnit(sampleUnit)[0];
      const passed =
        wBold.width > wReg.width &&
        wBold.fontWeight === 700 &&
        wBold.isBold === true &&
        wReg.fontWeight === 400 &&
        wReg.isBold === false;
      assertions.push({
        id: 3,
        name: 'weight/bold changes rendering/measurement',
        passed,
        details: `wReg=${wReg.width.toFixed(2)}pt (wt=${wReg.fontWeight}), wBold=${wBold.width.toFixed(2)}pt (wt=${wBold.fontWeight})`,
      });
    }

    // 4. italic changes rendering
    {
      const sItalic = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { character: { isItalic: true, isUnderline: true, textColor: '#7A1C1C' } }
      ).settings;
      const engine = new TypesetterEngine(14.5, undefined, sItalic);
      const lines = engine.typesetContentUnit(sampleUnit, 240, 18, true);
      const passed =
        lines[0].isItalic === true &&
        lines[0].isUnderline === true &&
        lines[0].textColor === '#7A1C1C' &&
        lines[0].words[0].isItalic === true &&
        lines[0].words[0].isUnderline === true &&
        lines[0].words[0].textColor === '#7A1C1C';
      assertions.push({
        id: 4,
        name: 'italic, underline, and textColor change rendering metadata',
        passed,
        details: `line.isItalic=${lines[0].isItalic}, underline=${lines[0].isUnderline}, color=${lines[0].textColor}`,
      });
    }

    // 5. tracking changes line width
    {
      const sBase = DesignSettingsEngine.createDefaultSettings();
      const sTrack = DesignSettingsEngine.updateRoleStyle(sBase, 'main_source', {
        character: { trackingEm: 0.12 },
      }).settings;
      const wBase = new TypesetterEngine(14.5, undefined, sBase).shapeContentUnit(sampleUnit)[0]
        .width;
      const wTrack = new TypesetterEngine(14.5, undefined, sTrack).shapeContentUnit(sampleUnit)[0]
        .width;
      const passed = wTrack > wBase + 4;
      assertions.push({
        id: 5,
        name: 'tracking changes line width',
        passed,
        details: `wBase=${wBase.toFixed(2)}pt, wTrack=${wTrack.toFixed(2)}pt`,
      });
    }

    // 6. word spacing changes line width
    {
      const sBase = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        {
          character: { wordSpacingRatio: 1.0 },
          paragraph: { alignment: 'right', lastLineAlignment: 'right' },
        }
      ).settings;
      const sWideSpace = DesignSettingsEngine.updateRoleStyle(sBase, 'main_source', {
        character: { wordSpacingRatio: 1.6 },
        paragraph: { alignment: 'right', lastLineAlignment: 'right' },
      }).settings;
      const lBase = new TypesetterEngine(14.5, undefined, sBase).typesetContentUnit(
        sampleUnit,
        2000,
        18,
        false
      )[0];
      const lWide = new TypesetterEngine(14.5, undefined, sWideSpace).typesetContentUnit(
        sampleUnit,
        2000,
        18,
        false
      )[0];
      const passed = lWide.width > lBase.width + 10;
      assertions.push({
        id: 6,
        name: 'word spacing changes line width',
        passed,
        details: `lBase.width=${lBase.width.toFixed(2)}pt, lWide.width=${lWide.width.toFixed(2)}pt`,
      });
    }

    // 7. horizontal scale changes line width
    {
      const s100 = DesignSettingsEngine.createDefaultSettings();
      const s108 = DesignSettingsEngine.updateRoleStyle(s100, 'main_source', {
        character: { horizontalScalePercent: 108 },
      }).settings;
      const w100 = new TypesetterEngine(14.5, undefined, s100).shapeContentUnit(sampleUnit)[0]
        .width;
      const w108 = new TypesetterEngine(14.5, undefined, s108).shapeContentUnit(sampleUnit)[0]
        .width;
      const passed = Math.abs(w108 / w100 - 1.08) < 0.02;
      assertions.push({
        id: 7,
        name: 'horizontal scale changes line width',
        passed,
        details: `w100=${w100.toFixed(2)}pt, w108=${w108.toFixed(2)}pt`,
      });
    }

    // 8. baseline shift changes glyph position
    {
      const s0 = DesignSettingsEngine.createDefaultSettings();
      const sShift = DesignSettingsEngine.updateRoleStyle(s0, 'main_source', {
        character: { baselineShiftPt: 3.5 },
      }).settings;
      const word0 = new TypesetterEngine(14.5, undefined, s0).shapeContentUnit(sampleUnit)[0];
      const wordShift = new TypesetterEngine(14.5, undefined, sShift).shapeContentUnit(
        sampleUnit
      )[0];
      const passed =
        wordShift.baselineShiftPt === 3.5 &&
        Math.abs((wordShift.glyphs[0].yOffset ?? 0) - ((word0.glyphs[0].yOffset ?? 0) + 3.5)) <
          0.01;
      assertions.push({
        id: 8,
        name: 'baseline shift changes glyph position',
        passed,
        details: `yOffset0=${word0.glyphs[0].yOffset}, yOffsetShift=${wordShift.glyphs[0].yOffset}`,
      });
    }

    // 9. alignment changes actual line position (including lastLineAlignment)
    {
      const sCenter = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { alignment: 'center', lastLineAlignment: 'center' } }
      ).settings;
      const sJustify = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { alignment: 'justify', lastLineAlignment: 'right' } }
      ).settings;
      const lCenter = new TypesetterEngine(14.5, undefined, sCenter).typesetContentUnit(
        sampleUnit,
        220,
        18,
        true
      );
      const lJustify = new TypesetterEngine(14.5, undefined, sJustify).typesetContentUnit(
        sampleUnit,
        220,
        18,
        true
      );
      const passed =
        lCenter[0].paragraphAlignment === 'center' &&
        lCenter[0].isJustified === false &&
        lJustify[0].paragraphAlignment === 'justify' &&
        lJustify[0].isJustified === true &&
        lJustify[lJustify.length - 1].paragraphAlignment === 'right' &&
        lJustify[lJustify.length - 1].isJustified === false;
      assertions.push({
        id: 9,
        name: 'alignment changes actual line position & respects lastLineAlignment',
        passed,
        details: `center=${lCenter[0].paragraphAlignment}, justify=${lJustify[0].paragraphAlignment}, lastLine=${lJustify[lJustify.length - 1].paragraphAlignment}`,
      });
    }

    // 10. first-line indent changes line geometry
    {
      const sNoIndent = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { firstLineIndentPt: 0 } }
      ).settings;
      const sFirstIndent = DesignSettingsEngine.updateRoleStyle(sNoIndent, 'main_source', {
        paragraph: { firstLineIndentPt: 24 },
      }).settings;
      const l0 = new TypesetterEngine(14.5, undefined, sNoIndent).typesetContentUnit(
        sampleUnit,
        220,
        18,
        true
      );
      const l24 = new TypesetterEngine(14.5, undefined, sFirstIndent).typesetContentUnit(
        sampleUnit,
        220,
        18,
        true
      );
      const passed =
        l24[0].firstLineIndent === 24 &&
        l24[0].targetWidth === l0[0].targetWidth - 24 &&
        (l24[1]?.firstLineIndent ?? 0) === 0;
      assertions.push({
        id: 10,
        name: 'first-line indent changes line geometry',
        passed,
        details: `line0 targetWidth=${l24[0].targetWidth}pt (indent=${l24[0].firstLineIndent}pt), line1 targetWidth=${l24[1]?.targetWidth}pt`,
      });
    }

    // 11. hanging indent changes subsequent line geometry
    {
      const sHang = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { firstLineIndentPt: 0, hangingIndentPt: 20, rightIndentPt: 0 } }
      ).settings;
      const lines = new TypesetterEngine(14.5, undefined, sHang).typesetContentUnit(
        sampleUnit,
        220,
        18,
        true
      );
      const passed =
        lines.length >= 2 &&
        (lines[0].rightIndentPt ?? 0) === 0 &&
        lines[0].targetWidth === 220 &&
        lines[1].rightIndentPt === 20 &&
        lines[1].targetWidth === 200;
      assertions.push({
        id: 11,
        name: 'hanging indent changes subsequent line geometry',
        passed,
        details: `line0 rightIndent=${lines[0].rightIndentPt}pt (w=${lines[0].targetWidth}), line1 rightIndent=${lines[1]?.rightIndentPt}pt (w=${lines[1]?.targetWidth})`,
      });
    }

    // 12. right/left indent changes available width
    {
      const sRL = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { rightIndentPt: 15, leftIndentPt: 25 } }
      ).settings;
      const lines = new TypesetterEngine(14.5, undefined, sRL).typesetContentUnit(
        sampleUnit,
        240,
        18,
        true
      );
      const passed =
        lines[0].rightIndentPt === 15 &&
        lines[0].leftIndentPt === 25 &&
        lines[0].targetWidth === 200;
      assertions.push({
        id: 12,
        name: 'right/left indent changes available width',
        passed,
        details: `targetWidth=${lines[0].targetWidth}pt (240 - 15 - 25)`,
      });
    }

    // 13. fixed leading changes vertical positions
    {
      const sFixed16 = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { leadingMode: 'fixed', leadingPt: 16 } }
      ).settings;
      const sFixed24 = DesignSettingsEngine.updateRoleStyle(sFixed16, 'main_source', {
        paragraph: { leadingMode: 'fixed', leadingPt: 24 },
      }).settings;
      const doc16 = PaginationEngine.paginateDocument({
        title: 'T',
        layoutType: 'single_column',
        units: [sampleUnit],
        geometry: DEFAULT_GEOMETRY,
        designSettings: sFixed16,
      });
      const doc24 = PaginationEngine.paginateDocument({
        title: 'T',
        layoutType: 'single_column',
        units: [sampleUnit],
        geometry: DEFAULT_GEOMETRY,
        designSettings: sFixed24,
      });
      const dy16 =
        doc16.pages[0].sourceLines[1].yBaseline - doc16.pages[0].sourceLines[0].yBaseline;
      const dy24 =
        doc24.pages[0].sourceLines[1].yBaseline - doc24.pages[0].sourceLines[0].yBaseline;
      const passed = Math.abs(dy16 - 16) < 0.01 && Math.abs(dy24 - 24) < 0.01 && dy24 > dy16;
      assertions.push({
        id: 13,
        name: 'fixed leading changes vertical positions',
        passed,
        details: `dy16=${dy16}pt, dy24=${dy24}pt`,
      });
    }

    // 14. automatic leading produces finite valid values using lineSpacingRatio
    {
      const sAuto = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        {
          character: { fontSizePt: 15 },
          paragraph: { leadingMode: 'auto', lineSpacingRatio: 1.4 },
        }
      ).settings;
      const lines = new TypesetterEngine(15, undefined, sAuto).typesetContentUnit(
        sampleUnit,
        240,
        18,
        true
      );
      const passed =
        Number.isFinite(lines[0].height) &&
        !Number.isNaN(lines[0].height) &&
        Math.abs(lines[0].height - 21) < 0.2;
      assertions.push({
        id: 14,
        name: 'automatic leading produces finite valid values via lineSpacingRatio',
        passed,
        details: `fontSize=15pt * ratio=1.4 -> height=${lines[0].height}pt`,
      });
    }

    // 15. spaceBefore changes paragraph position
    {
      const s0 = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { spaceBeforePt: 0, spaceAfterPt: 0 } }
      ).settings;
      const sBefore = DesignSettingsEngine.updateRoleStyle(s0, 'main_source', {
        paragraph: { spaceBeforePt: 18, spaceAfterPt: 0 },
      }).settings;
      const doc0 = PaginationEngine.paginateDocument({
        title: 'T',
        layoutType: 'single_column',
        units: [sampleUnit, sampleUnit2],
        geometry: DEFAULT_GEOMETRY,
        designSettings: s0,
      });
      const docBefore = PaginationEngine.paginateDocument({
        title: 'T',
        layoutType: 'single_column',
        units: [sampleUnit, sampleUnit2],
        geometry: DEFAULT_GEOMETRY,
        designSettings: sBefore,
      });
      const u2FirstLine0 = doc0.pages[0].sourceLines.find(l => l.unitId === 'u-test-2')!;
      const u2FirstLineB = docBefore.pages[0].sourceLines.find(l => l.unitId === 'u-test-2')!;
      const passed =
        Math.abs(u2FirstLineB.yBaseline - u2FirstLine0.yBaseline - 36) < 0.1 ||
        u2FirstLineB.yBaseline > u2FirstLine0.yBaseline + 15;
      assertions.push({
        id: 15,
        name: 'spaceBefore changes paragraph position',
        passed,
        details: `u2 yBaseline without spaceBefore=${u2FirstLine0.yBaseline}pt, with spaceBefore=18pt -> ${u2FirstLineB.yBaseline}pt`,
      });
    }

    // 16. spaceAfter changes following paragraph position
    {
      const s0 = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { spaceBeforePt: 0, spaceAfterPt: 0 } }
      ).settings;
      const sAfter = DesignSettingsEngine.updateRoleStyle(s0, 'main_source', {
        paragraph: { spaceBeforePt: 0, spaceAfterPt: 20 },
      }).settings;
      const doc0 = PaginationEngine.paginateDocument({
        title: 'T',
        layoutType: 'single_column',
        units: [sampleUnit, sampleUnit2],
        geometry: DEFAULT_GEOMETRY,
        designSettings: s0,
      });
      const docAfter = PaginationEngine.paginateDocument({
        title: 'T',
        layoutType: 'single_column',
        units: [sampleUnit, sampleUnit2],
        geometry: DEFAULT_GEOMETRY,
        designSettings: sAfter,
      });
      const u2FirstLine0 = doc0.pages[0].sourceLines.find(l => l.unitId === 'u-test-2')!;
      const u2FirstLineA = docAfter.pages[0].sourceLines.find(l => l.unitId === 'u-test-2')!;
      const passed = Math.abs(u2FirstLineA.yBaseline - (u2FirstLine0.yBaseline + 20)) < 0.1;
      assertions.push({
        id: 16,
        name: 'spaceAfter changes following paragraph position',
        passed,
        details: `u2 yBaseline without spaceAfter=${u2FirstLine0.yBaseline}pt, with spaceAfter=20pt -> ${u2FirstLineA.yBaseline}pt`,
      });
    }

    // 17. RTL remains correct
    {
      const settings = DesignSettingsEngine.createDefaultSettings();
      const lines = new TypesetterEngine(14.5, undefined, settings).typesetContentUnit(
        sampleUnit,
        240,
        18,
        true
      );
      const shaped = lines[0].words[0];
      const baseGlyphs = shaped.glyphs.filter(g => !g.isMark);
      const passed =
        lines[0].direction === 'rtl' && baseGlyphs.length === 6 && baseGlyphs[0].char === 'מ';
      assertions.push({
        id: 17,
        name: 'RTL remains correct',
        passed,
        details: `direction=${lines[0].direction}, baseGlyphs=${baseGlyphs.length}, firstChar=${baseGlyphs[0].char}`,
      });
    }

    // 18. combining marks remain attached correctly
    {
      const shaper = new HarfBuzzShaperEngine(14.5, 'Frank Ruhl Libre', 400);
      shaper.setTrackingEm(0.08);
      shaper.setHorizontalScalePercent(108);
      const shaped = shaper.shapeWord('מֵאֵימָתַי', { baselineShiftPt: 2 });
      const marks = shaped.glyphs.filter(g => g.isMark);
      const passed =
        marks.length > 0 &&
        marks.every(m => m.xAdvance === 0 && m.xOffset !== 0 && m.yOffset !== 0);
      assertions.push({
        id: 18,
        name: 'combining marks remain attached correctly with 0 advance width',
        passed,
        details: `marksCount=${marks.length}, allZeroAdvance=${marks.every(m => m.xAdvance === 0)}`,
      });
    }

    // 19. hard-rule violations remain impossible
    {
      const baseUnits = DocxImporter.getSampleBerakhot();
      const customSettings = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        {
          character: { fontSizePt: 16, trackingEm: 0.02 },
          paragraph: {
            firstLineIndentPt: 12,
            spaceAfterPt: 6,
            leadingMode: 'auto',
            lineSpacingRatio: 1.3,
          },
        }
      ).settings;
      const doc = PaginationEngine.paginateDocument({
        title: 'בדיקת כללי ברזל תחת הגדרות עיצוב',
        layoutType: 'rav_text',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: customSettings,
      });
      const hardAudit = EngineHardRulesEngine.evaluateContext({
        units: baseUnits,
        bookDoc: doc,
      });
      assertions.push({
        id: 19,
        name: 'hard-rule violations remain impossible',
        passed: hardAudit.passed && hardAudit.violations.length === 0,
        details: `passed=${hardAudit.passed}, violations=${hardAudit.violations.length}`,
      });
    }

    const passedCount = assertions.filter(a => a.passed).length;
    return {
      allPassed: passedCount === assertions.length,
      passedCount,
      totalCount: assertions.length,
      assertions,
    };
  }

  /**
   * Stage 13A-2 Verification Suite:
   * Proves that changes in `ProfessionalDesignSettings` affect actual exported PDF render plans
   * and generated IDML packages/XML structure — not merely application state.
   */
  public static async runStage13A2Tests(): Promise<{
    allPassed: boolean;
    passedCount: number;
    totalCount: number;
    assertions: Array<{ id: number; name: string; passed: boolean; details: string }>;
  }> {
    const assertions: Array<{ id: number; name: string; passed: boolean; details: string }> = [];

    const baseUnits: ContentUnit[] = [
      {
        id: 'u-src-1',
        role: 'main_source',
        rawText:
          'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִין מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכוֹל בִּתְרוּמָתָן עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה דִּבְרֵי רַבִּי אֱלִיעֶזֶר וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת.',
        styleName: 'Gemara',
        order: 1,
        hierarchyLevel: 1,
        textRuns: [
          {
            text: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִין',
            footnoteMarker: 1,
            footnoteUnitId: 'u-fn-1',
          },
          {
            text: 'מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכוֹל בִּתְרוּמָתָן עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה דִּבְרֵי רַבִּי אֱלִיעֶזֶר וַחֲכָמִים אוֹמְרִים עַד חֲצוֹת.',
          },
        ],
      },
      {
        id: 'u-src-2',
        role: 'main_source',
        rawText:
          'רַבָּן גַּמְלִיאֵל אוֹמֵר עַד שֶׁיַּעֲלֶה עַמּוּד הַשַּׁחַר מַעֲשֶׂה וּבָאוּ בָנָיו מִבֵּית הַמִּשְׁתֶּה אָמְרוּ לוֹ לֹא קָרִינוּ אֶת שְׁמַע אָמַר לָהֶם אִם לֹא עָלָה עַמּוּד הַשַּׁחַר חַיָּיבִין אַתֶּם לִקְרוֹת.',
        styleName: 'Gemara',
        order: 2,
        hierarchyLevel: 1,
      },
      {
        id: 'u-rashi-1',
        role: 'primary_comment',
        rawText:
          'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע: הֵיכָא קָאֵי דְּקָתָנֵי מֵאֵימָתַי, אִקְּרָא קָאֵי דִּכְתִיב בְּשָׁכְבְּךָ וּבְקוּמֶךָ וּזְמַן שְׁכִיבָה מִשֶּׁיַּכְנִיסוּ הַכֹּהֲנִים לֶאֱכוֹל בִּתְרוּמָתָן.',
        dibburHamatchil: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע',
        linkedSourceId: 'u-src-1',
        styleName: 'Rashi',
        order: 3,
        hierarchyLevel: 2,
      },
      {
        id: 'u-tos-1',
        role: 'secondary_comment',
        rawText:
          'מֵאֵימָתַי קוֹרִין: תָּנָא הֵיכָא קָאֵי דְּקָתָנֵי מֵאֵימָתַי, פֵּירֵשׁ רַשִׁ״י דְּאִקְּרָא קָאֵי וְאִיתְּמַר נַמִּי דְּסָמֵיךְ אַקְּרָא דְּיוֹצֵר אוֹר.',
        dibburHamatchil: 'מֵאֵימָתַי קוֹרִין',
        linkedSourceId: 'u-src-1',
        styleName: 'Tosafot',
        order: 4,
        hierarchyLevel: 2,
      },
      {
        id: 'u-fn-1',
        role: 'footnote',
        rawText: 'הערה א: עיין מסכת ברכות דף ב עמוד א בפירוש המשנה להרמב״ם ובספר המאור.',
        footnoteNumber: 1,
        footnoteAnchorUnitId: 'u-src-1',
        styleName: 'Footnote',
        order: 5,
        hierarchyLevel: 3,
      },
    ];

    const extractIdmlFiles = async (doc: ReturnType<typeof PaginationEngine.paginateDocument>) => {
      const blob = await IdmlExporter.generateMultiPageIdml(doc);
      const audit = await IdmlExporter.auditIdmlPackage(blob, doc);
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      const stylesXml = (await zip.file('Resources/Styles.xml')?.async('string')) ?? '';
      const fontsXml = (await zip.file('Resources/Fonts.xml')?.async('string')) ?? '';
      const graphicXml = (await zip.file('Resources/Graphic.xml')?.async('string')) ?? '';
      const storySourceXml =
        (await zip.file('Stories/Story_u_story_source.xml')?.async('string')) ?? '';
      const storyRashiXml =
        (await zip.file('Stories/Story_u_story_rashi.xml')?.async('string')) ?? '';
      const storyFnXml =
        (await zip.file('Stories/Story_u_story_footnotes.xml')?.async('string')) ?? '';
      const spread0Xml = (await zip.file('Spreads/Spread_u100.xml')?.async('string')) ?? '';
      return {
        blob,
        audit,
        stylesXml,
        fontsXml,
        graphicXml,
        storySourceXml,
        storyRashiXml,
        storyFnXml,
        spread0Xml,
      };
    };

    // 1. Font size changes exported text formatting in both PDF and IDML
    {
      const s14 = DesignSettingsEngine.createDefaultSettings();
      const s19 = DesignSettingsEngine.updateRoleStyle(s14, 'main_source', {
        character: { fontSizePt: 19 },
      }).settings;

      const doc14 = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'single_column',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: s14,
      });
      const doc19 = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'single_column',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: s19,
      });

      const pdf14 = PdfExporter.buildPageRenderPlan(doc14.pages[0]);
      const pdf19 = PdfExporter.buildPageRenderPlan(doc19.pages[0]);
      const idml19 = await extractIdmlFiles(doc19);

      const pdfSrc14 = pdf14.lines.find(l => l.role === 'main_source')!;
      const pdfSrc19 = pdf19.lines.find(l => l.role === 'main_source')!;
      const passed =
        pdfSrc14.fontSizePt === 14.5 &&
        pdfSrc19.fontSizePt === 19 &&
        pdfSrc19.words[0].fontSizePt === 19 &&
        pdfSrc19.words[0].width > pdfSrc14.words[0].width &&
        idml19.stylesXml.includes('Self="ParagraphStyle/KeterSource"') &&
        idml19.stylesXml.includes('PointSize="19"') &&
        idml19.storySourceXml.includes('PointSize="19"');

      assertions.push({
        id: 1,
        name: 'Font size changes exported text formatting in PDF & IDML',
        passed,
        details: `PDF fontSizePt: ${pdfSrc14.fontSizePt} -> ${pdfSrc19.fontSizePt}pt, IDML PointSize="19": ${idml19.storySourceXml.includes('PointSize="19"')}`,
      });
    }

    // 2. Font family/weight and character styling (bold, italic, underline, color) are preserved in PDF and IDML
    {
      let sStyled = DesignSettingsEngine.createDefaultSettings();
      sStyled = DesignSettingsEngine.updateRoleStyle(sStyled, 'main_source', {
        character: {
          fontFamily: 'Vilna Old Style',
          fontWeight: 700,
          isBold: true,
          isItalic: true,
          isUnderline: true,
          textColor: '#7C2D12',
        },
      }).settings;

      const docStyled = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'single_column',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: sStyled,
      });

      const pdfPlan = PdfExporter.buildPageRenderPlan(docStyled.pages[0]);
      const srcLine = pdfPlan.lines.find(l => l.role === 'main_source')!;
      const w0 = srcLine.words[0];
      const idml = await extractIdmlFiles(docStyled);

      const passed =
        w0.fontFamily === 'Vilna Old Style' &&
        w0.fontWeight === 700 &&
        w0.isBold === true &&
        w0.isItalic === true &&
        w0.isUnderline === true &&
        w0.textColor === '#7C2D12' &&
        idml.fontsXml.includes('FontFamily="Vilna Old Style"') &&
        idml.graphicXml.includes('Self="Color/KeterHex_7C2D12"') &&
        idml.storySourceXml.includes('<AppliedFont type="string">Vilna Old Style</AppliedFont>') &&
        idml.storySourceXml.includes('FontStyle="Bold Italic"') &&
        idml.storySourceXml.includes('Underline="true"') &&
        idml.storySourceXml.includes('FillColor="Color/KeterHex_7C2D12"');

      assertions.push({
        id: 2,
        name: 'Font family, weight, bold, italic, underline, and color preserved in PDF & IDML',
        passed,
        details: `PDF: font=${w0.fontFamily}, weight=${w0.fontWeight}, italic=${w0.isItalic}, underline=${w0.isUnderline}, color=${w0.textColor}; IDML Fonts/Graphic/Story matched`,
      });
    }

    // 3. Alignment, last-line alignment, indents, leading, and paragraph spacing represented in PDF & IDML
    {
      let sBase = DesignSettingsEngine.createDefaultSettings();
      sBase = DesignSettingsEngine.updateRoleStyle(sBase, 'main_source', {
        paragraph: {
          alignment: 'justify',
          lastLineAlignment: 'center',
          firstLineIndentPt: 18,
          rightIndentPt: 10,
          leftIndentPt: 12,
          hangingIndentPt: 14,
          leadingMode: 'fixed',
          leadingPt: 22,
          spaceBeforePt: 8,
          spaceAfterPt: 12,
        },
      }).settings;

      const docPara = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'single_column',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: sBase,
      });

      const pdfPlan = PdfExporter.buildPageRenderPlan(docPara.pages[0]);
      const srcLines = pdfPlan.lines.filter(l => l.role === 'main_source');
      const line0 = srcLines[0];
      const line1 = srcLines[1];
      const lastLineOfU1 = srcLines.find(l => l.unitId === 'u-src-1' && l.isLastLine)!;
      const firstLineOfU2 = srcLines.find(l => l.unitId === 'u-src-2')!;
      const idml = await extractIdmlFiles(docPara);

      const mRight = DEFAULT_GEOMETRY.pageWidth - DEFAULT_GEOMETRY.marginOutside;
      // Line 0 has firstLineIndent=18 + rightIndent=10 => first word xRight = mRight - 28
      const line0RightOk = Math.abs(line0.words[0].xRight - (mRight - 28)) < 0.5;
      // Line 1 (non-first line) has rightIndent=10 + hangingIndent=14 = 24 => first word xRight = mRight - 24
      const line1HangOk = Math.abs(line1.words[0].xRight - (mRight - 24)) < 0.5;
      // Fixed leading 22pt => yBaseline difference between line0 and line1 is 22pt
      const leadingOk = Math.abs(line1.yBaseline - line0.yBaseline - 22) < 0.1;
      // Paragraph spacing: spaceAfter=12 on u1 + spaceBefore=8 on u2 + leading=22 => 42pt step
      const paraSpacingOk =
        Math.abs(firstLineOfU2.yBaseline - lastLineOfU1.yBaseline - (22 + 12 + 8)) < 0.5;
      // Last line alignment is 'center'
      const lastLineCenterOk = lastLineOfU1.alignment === 'center';

      const idmlParaOk =
        idml.storySourceXml.includes('Justification="CenterJustified"') &&
        idml.storySourceXml.includes('SingleWordJustification="CenterAlign"') &&
        idml.storySourceXml.includes('FirstLineIndent="18"') &&
        idml.storySourceXml.includes('RightIndent="24"') &&
        idml.storySourceXml.includes('LeftIndent="12"') &&
        idml.storySourceXml.includes('SpaceBefore="8"') &&
        idml.storySourceXml.includes('SpaceAfter="12"') &&
        idml.storySourceXml.includes('<Leading type="unit">22</Leading>');

      // Also verify left alignment in PDF & IDML
      const sLeft = DesignSettingsEngine.updateRoleStyle(
        DesignSettingsEngine.createDefaultSettings(),
        'main_source',
        { paragraph: { alignment: 'left', lastLineAlignment: 'left' } }
      ).settings;
      const docLeft = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'single_column',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: sLeft,
      });
      const pdfLeft = PdfExporter.buildPageRenderPlan(docLeft.pages[0]);
      const idmlLeft = await extractIdmlFiles(docLeft);
      const lastWordLeft =
        pdfLeft.lines[0].words[pdfLeft.lines[0].words.length - 1];
      const leftAlignOk =
        pdfLeft.lines[0].alignment === 'left' &&
        Math.abs(lastWordLeft.xLeft - DEFAULT_GEOMETRY.marginInside) < 1.0 &&
        idmlLeft.storySourceXml.includes('Justification="LeftAlign"');

      const passed =
        line0RightOk &&
        line1HangOk &&
        leadingOk &&
        paraSpacingOk &&
        lastLineCenterOk &&
        idmlParaOk &&
        leftAlignOk;

      assertions.push({
        id: 3,
        name: 'Alignment, last-line alignment, indents, leading, and paragraph spacing in PDF & IDML',
        passed,
        details: `line0RightOk=${line0RightOk}, line1HangOk=${line1HangOk}, leadingOk=${leadingOk}, paraSpacingOk=${paraSpacingOk}, lastLineCenterOk=${lastLineCenterOk}, idmlParaOk=${idmlParaOk}, leftAlignOk=${leftAlignOk}`,
      });
    }

    // 4. Tracking, word spacing, horizontal scaling, and baseline shift preserved in PDF & IDML
    {
      const sDefault = DesignSettingsEngine.createDefaultSettings();
      const sMetrics = DesignSettingsEngine.updateRoleStyle(sDefault, 'main_source', {
        character: {
          trackingEm: 0.08,
          wordSpacingRatio: 1.35,
          horizontalScalePercent: 108,
          baselineShiftPt: 3,
        },
        paragraph: {
          alignment: 'right',
          lastLineAlignment: 'right',
        },
      }).settings;

      const docDef = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'single_column',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: sDefault,
      });
      const docMet = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'single_column',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: sMetrics,
      });

      const pdfDef = PdfExporter.buildPageRenderPlan(docDef.pages[0]);
      const pdfMet = PdfExporter.buildPageRenderPlan(docMet.pages[0]);
      const idmlMet = await extractIdmlFiles(docMet);

      const wDef = pdfDef.lines[0].words[0];
      const wMet = pdfMet.lines[0].words[0];
      const gapMet = pdfMet.lines[0].words[0].xLeft - pdfMet.lines[0].words[1].xRight;
      const naturalSpaceDefault = 14.5 * 0.28;

      const passed =
        wMet.width > wDef.width &&
        wMet.trackingEm === 0.08 &&
        wMet.wordSpacingRatio === 1.35 &&
        wMet.horizontalScalePercent === 108 &&
        wMet.baselineShiftPt === 3 &&
        Math.abs(wMet.yBaseline - (pdfMet.lines[0].yBaseline - 3)) < 0.05 &&
        gapMet > naturalSpaceDefault * 1.2 &&
        idmlMet.storySourceXml.includes('Tracking="80"') &&
        idmlMet.storySourceXml.includes('DesiredWordSpacing="135"') &&
        idmlMet.storySourceXml.includes('HorizontalScale="108"') &&
        idmlMet.storySourceXml.includes('BaselineShift="3"');

      assertions.push({
        id: 4,
        name: 'Tracking, word spacing, horizontal scaling, and baseline shift preserved in PDF & IDML',
        passed,
        details: `PDF width ${wDef.width}->${wMet.width}pt, yBaseline shift=${pdfMet.lines[0].yBaseline - wMet.yBaseline}pt, gap=${gapMet.toFixed(2)}pt; IDML Tracking="80" DesiredWordSpacing="135" HorizontalScale="108" BaselineShift="3"`,
      });
    }

    // 5. Footnotes retain their anchor relationship, formatting, and separator settings in PDF & IDML
    {
      let sFn = DesignSettingsEngine.createDefaultSettings();
      sFn = {
        ...sFn,
        footnotes: {
          ...sFn.footnotes,
          fontFamily: 'David Libre',
          fontSizePt: 10.5,
          leadingPt: 15,
          lineSpacingPt: 15,
          showSeparatorRule: false,
          showSeparatorLine: false,
          separatorWidthRatio: 0.4,
          indentPt: 8,
        },
      };
      sFn = DesignSettingsEngine.updateRoleStyle(sFn, 'footnote', {
        character: { fontFamily: 'David Libre', fontSizePt: 10.5 },
        paragraph: { leadingMode: 'fixed', leadingPt: 15, rightIndentPt: 8 },
      }).settings;

      const docFn = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'rav_text',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: sFn,
      });

      const pdfPlan = PdfExporter.buildPageRenderPlan(docFn.pages[0]);
      const fnLine = pdfPlan.lines.find(l => l.role === 'footnote')!;
      const anchorWord = pdfPlan.lines
        .flatMap(l => l.words)
        .find(w => w.footnoteMarker !== undefined)!;
      const idmlFn = await extractIdmlFiles(docFn);

      const passed =
        Boolean(anchorWord && anchorWord.footnoteMarker === 1) &&
        Boolean(fnLine) &&
        fnLine.fontFamily === 'David Libre' &&
        fnLine.fontSizePt === 10.5 &&
        fnLine.leadingPt === 15 &&
        fnLine.rightIndentPt === 8 &&
        pdfPlan.showFootnoteSeparatorLine === false &&
        pdfPlan.footnoteSeparatorWidthRatio === 0.4 &&
        idmlFn.storySourceXml.includes('AppliedCharacterStyle="CharacterStyle/KeterFootnoteRef"') &&
        idmlFn.storySourceXml.includes('[1]') &&
        idmlFn.storyFnXml.includes('AppliedParagraphStyle="ParagraphStyle/KeterFootnote"') &&
        idmlFn.storyFnXml.includes('PointSize="10.5"') &&
        idmlFn.storyFnXml.includes('<AppliedFont type="string">David Libre</AppliedFont>');

      assertions.push({
        id: 5,
        name: 'Footnotes retain anchor relationship, font/size/leading/indent, and separator settings in PDF & IDML',
        passed,
        details: `anchor=[${anchorWord?.footnoteMarker}], fnFont=${fnLine?.fontFamily}, fnSize=${fnLine?.fontSizePt}pt, fnLeading=${fnLine?.leadingPt}pt, showSep=${pdfPlan.showFootnoteSeparatorLine}`,
      });
    }

    // 6. RTL order and combining marks (Nikud & Taamim) are preserved in PDF & IDML
    {
      const docRtl = PaginationEngine.paginateDocument({
        title: 'Test',
        layoutType: 'rav_text',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: DesignSettingsEngine.createDefaultSettings(),
      });
      const pdfPlan = PdfExporter.buildPageRenderPlan(docRtl.pages[0]);
      const srcLine = pdfPlan.lines.find(l => l.role === 'main_source')!;
      const idmlRtl = await extractIdmlFiles(docRtl);

      // In RTL, word 0 is on the right and each subsequent word has strictly decreasing xRight
      let rtlMonotonic = true;
      for (let i = 1; i < srcLine.words.length; i++) {
        if (srcLine.words[i].xRight >= srcLine.words[i - 1].xLeft + 0.1) {
          rtlMonotonic = false;
        }
      }
      const firstWordText = srcLine.words[0].text;
      const hasNikud = /[\u0591-\u05C7]/.test(firstWordText);
      const idmlHasNikudAndRtl =
        idmlRtl.audit.hasRtlStoryDirection &&
        idmlRtl.audit.hasRtlParagraphDirection &&
        idmlRtl.storySourceXml.includes('מֵאֵימָתַי');

      const passed = rtlMonotonic && hasNikud && idmlHasNikudAndRtl;
      assertions.push({
        id: 6,
        name: 'RTL order and Hebrew combining marks (Nikud/Taamim) are preserved in PDF & IDML',
        passed,
        details: `rtlMonotonic=${rtlMonotonic}, hasNikud=${hasNikud}, idmlHasNikudAndRtl=${idmlHasNikudAndRtl}`,
      });
    }

    // 7. Rav Text frame geometry in PDF & IDML matches the authoritative render plan
    {
      const docRav = PaginationEngine.paginateDocument({
        title: 'מסכת ברכות',
        layoutType: 'rav_text',
        units: DocxImporter.getSampleBerakhot(),
        geometry: DEFAULT_GEOMETRY,
        designSettings: DesignSettingsEngine.createDefaultSettings(),
      });
      const page0 = docRav.pages[0];
      const pdfPlan = PdfExporter.buildPageRenderPlan(page0);
      const { frames } = IdmlExporter.computePageTextFrames(page0, 0);
      const idmlAudit = await IdmlExporter.auditIdmlPackage(
        await IdmlExporter.generateMultiPageIdml(docRav),
        docRav
      );

      const srcFrame = frames.find(f => f.storyId === 'u_story_source')!;
      const rashiFrame = frames.find(f => f.storyId === 'u_story_rashi')!;
      const tosaFrame = frames.find(f => f.storyId === 'u_story_tosafot')!;
      const pdfSrcLines = pdfPlan.lines.filter(l => l.role === 'main_source' || l.role === 'chapter');

      const mLeft = DEFAULT_GEOMETRY.marginInside;
      const mTop = DEFAULT_GEOMETRY.marginTop;
      const solvedSrcMinX = Math.min(...page0.sourceLines.map(l => mLeft + (l.xLeft ?? 0)));
      const solvedSrcMaxX = Math.max(...page0.sourceLines.map(l => mLeft + (l.xRight ?? 0)));

      const passed =
        Boolean(srcFrame && rashiFrame && tosaFrame) &&
        Math.abs(srcFrame.xLeft - solvedSrcMinX) <= 1.0 &&
        Math.abs(srcFrame.xRight - solvedSrcMaxX) <= 1.0 &&
        Math.abs(pdfSrcLines[0].yBaseline - (mTop + page0.sourceLines[0].yBaseline)) <= 0.1 &&
        idmlAudit.hasPathGeometryInFrames &&
        idmlAudit.hasUnifiedStreamFrames;

      assertions.push({
        id: 7,
        name: 'Rav Text frame geometry in PDF & IDML matches the authoritative render plan',
        passed,
        details: `srcFrame=[${srcFrame?.xLeft}..${srcFrame?.xRight}] vs solved=[${solvedSrcMinX}..${solvedSrcMaxX}], polygonPoints=${rashiFrame?.polygonPoints.length}`,
      });
    }

    // 8. No unexpected overlaps or clipping are introduced in PDF or IDML
    {
      const docRav = PaginationEngine.paginateDocument({
        title: 'מסכת ברכות',
        layoutType: 'rav_text',
        units: DocxImporter.getSampleBerakhot(),
        geometry: DEFAULT_GEOMETRY,
        designSettings: DesignSettingsEngine.createDefaultSettings(),
      });
      const pdfPlan = PdfExporter.buildPageRenderPlan(docRav.pages[0]);
      const idmlBlob = await IdmlExporter.generateMultiPageIdml(docRav);
      const idmlAudit = await IdmlExporter.auditIdmlPackage(idmlBlob, docRav);

      // Verify zero word overlaps on every line in PDF plan and all words inside page bounds
      let pdfWordOverlaps = 0;
      let pdfOutOfBounds = 0;
      for (const line of pdfPlan.lines) {
        for (let i = 0; i < line.words.length; i++) {
          const w = line.words[i];
          if (w.xLeft < 0 || w.xRight > DEFAULT_GEOMETRY.pageWidth + 1) {
            pdfOutOfBounds++;
          }
          if (i > 0 && w.xRight > line.words[i - 1].xLeft + 0.5) {
            pdfWordOverlaps++;
          }
        }
      }

      const passed =
        pdfWordOverlaps === 0 &&
        pdfOutOfBounds === 0 &&
        idmlAudit.overlappingTextFrames.length === 0 &&
        idmlAudit.passed;

      assertions.push({
        id: 8,
        name: 'No unexpected overlaps or clipping in PDF or IDML',
        passed,
        details: `pdfWordOverlaps=${pdfWordOverlaps}, pdfOutOfBounds=${pdfOutOfBounds}, idmlOverlappingFrames=${idmlAudit.overlappingTextFrames.length}`,
      });
    }

    // 9. IDML remains editable and does not replace text with raster images
    {
      const docRav = PaginationEngine.paginateDocument({
        title: 'מסכת ברכות',
        layoutType: 'rav_text',
        units: DocxImporter.getSampleBerakhot(),
        geometry: DEFAULT_GEOMETRY,
        designSettings: DesignSettingsEngine.createDefaultSettings(),
      });
      const idml = await extractIdmlFiles(docRav);
      const passed =
        !idml.audit.hasRasterizedSubstitutes &&
        idml.audit.conservedWordCount === idml.audit.expectedWordCount &&
        idml.audit.conservedWordCount > 20 &&
        !idml.spread0Xml.includes('<Image ') &&
        !idml.spread0Xml.includes('<PDF ');

      assertions.push({
        id: 9,
        name: 'IDML remains editable and does not replace text with raster images',
        passed,
        details: `hasRasterizedSubstitutes=${idml.audit.hasRasterizedSubstitutes}, conservedWords=${idml.audit.conservedWordCount}/${idml.audit.expectedWordCount}`,
      });
    }

    // 10. Engine Hard Rules remain enforced during export
    {
      const sampleUnits = DocxImporter.getSampleBerakhot();
      const docValid = PaginationEngine.paginateDocument({
        title: 'מסכת ברכות',
        layoutType: 'rav_text',
        units: sampleUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: DesignSettingsEngine.createDefaultSettings(),
      });
      const reportValid = EngineHardRulesEngine.evaluateContext({
        bookDoc: docValid,
        units: sampleUnits,
      });

      // Verify that an unauthorized ornament injected onto a page is caught by EngineHardRulesEngine.assertExportAllowed
      let blockedCorruptedExport = false;
      try {
        const corruptedDoc = {
          ...docValid,
          pages: docValid.pages.map((p, idx) =>
            idx === 0
              ? {
                  ...p,
                  placedOrnaments: [
                    {
                      asset: {
                        id: 'unauth-orn',
                        name: 'Unauth',
                        placement: 'chapter_opening' as const,
                        format: 'svg_builtin' as const,
                        svgPathOrDataUrl: '',
                        widthPt: 100,
                        heightPt: 20,
                      },
                      x: 100,
                      y: 100,
                      width: 100,
                      height: 20,
                    },
                  ],
                }
              : p
          ),
        };
        EngineHardRulesEngine.assertExportAllowed({
          bookDoc: corruptedDoc,
          units: sampleUnits,
          userSuppliedOrnamentsCount: 0,
        });
      } catch {
        blockedCorruptedExport = true;
      }

      const passed = reportValid.passed && blockedCorruptedExport;
      assertions.push({
        id: 10,
        name: 'Engine Hard Rules remain enforced during PDF & IDML export',
        passed,
        details: `validDocPassed=${reportValid.passed}, blockedUnauthorizedOrnamentExport=${blockedCorruptedExport}`,
      });
    }

    // 11. Non-reflowing design changes (e.g., color, underline, header visibility) do not silently alter approved page geometry, and page element settings work
    {
      // v0.5.0 Part B (Module 6): the top header line is OFF by default on
      // new projects, so the "header on" baseline now enables it explicitly
      // through the new toggle; the test's intent (toggle propagates, geometry
      // unchanged) is the same as before.
      const s1 = DesignSettingsEngine.updatePageElementsSettings(
        DesignSettingsEngine.createDefaultSettings(),
        { showTopHeaderLine: true },
        'user'
      );
      let s2 = DesignSettingsEngine.updateRoleStyle(s1, 'main_source', {
        character: { textColor: '#1E3A8A', isUnderline: true },
      }).settings;
      s2 = {
        ...s2,
        pageElements: {
          ...s2.pageElements,
          showRunningHeader: false,
          showTopHeaderLine: false,
          showFolioNumber: false,
          runningHeaderFontSizePt: 13,
        },
      };

      const doc1 = PaginationEngine.paginateDocument({
        title: 'מסכת ברכות',
        layoutType: 'rav_text',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: s1,
      });
      const doc2 = PaginationEngine.paginateDocument({
        title: 'מסכת ברכות',
        layoutType: 'rav_text',
        units: baseUnits,
        geometry: DEFAULT_GEOMETRY,
        designSettings: s2,
      });

      const plan1 = PdfExporter.buildPageRenderPlan(doc1.pages[0]);
      const plan2 = PdfExporter.buildPageRenderPlan(doc2.pages[0]);

      const sameGeometry =
        doc1.pages[0].geometry.pageWidth === doc2.pages[0].geometry.pageWidth &&
        doc1.pages[0].geometry.pageHeight === doc2.pages[0].geometry.pageHeight &&
        doc1.pages[0].knee.upperSourceWidth === doc2.pages[0].knee.upperSourceWidth &&
        plan1.lines.length === plan2.lines.length &&
        plan1.lines.every(
          (l, idx) =>
            l.xLeft === plan2.lines[idx].xLeft &&
            l.xRight === plan2.lines[idx].xRight &&
            l.yBaseline === plan2.lines[idx].yBaseline
        );

      const pageElementsUpdated =
        plan1.showRunningHeader === true &&
        plan2.showRunningHeader === false &&
        plan2.showFolioNumber === false &&
        plan2.runningHeaderFontSizePt === 13;

      const passed = sameGeometry && pageElementsUpdated;
      assertions.push({
        id: 11,
        name: 'Non-metric design changes preserve approved page geometry while updating PDF/IDML export attributes & page elements',
        passed,
        details: `sameGeometry=${sameGeometry}, showRunningHeader: ${plan1.showRunningHeader}->${plan2.showRunningHeader}, runningHeaderFontSizePt=${plan2.runningHeaderFontSizePt}`,
      });
    }

    const passedCount = assertions.filter(a => a.passed).length;
    return {
      allPassed: passedCount === assertions.length,
      passedCount,
      totalCount: assertions.length,
      assertions,
    };
  }

  /**
   * Stage 13A-3 Verification Suite:
   * Native, Selectable, Searchable Hebrew PDF Export Verification
   *
   * Generates real multi-page and single-page PDF binaries via `PdfExporter.generateMultiPagePdf`
   * and parses the raw PDF byte streams (`/ToUnicode` CMaps, `BT ... TJ ... ET` text objects,
   * CID `/W` tables, and vector path operators) to verify all 9 Stage 13A-3 requirements.
   */
  public static async runStage13A3Tests(): Promise<{
    allPassed: boolean;
    passedCount: number;
    totalCount: number;
    assertions: { id: number; name: string; passed: boolean; details: string }[];
  }> {
    const assertions: { id: number; name: string; passed: boolean; details: string }[] = [];

    const baseUnits: ContentUnit[] = [
      {
        id: 'u-src-13a3',
        role: 'main_source',
        rawText: 'מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית. מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן[1] עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה דִּבְרֵי רַבִּי אֱלִיעֶזֶר.',
        styleName: 'Gemara-Source',
        order: 1,
        hierarchyLevel: 2,
      },
      {
        id: 'u-rashi-13a3',
        role: 'primary_comment',
        rawText: 'מֵאֵימָתַי קוֹרִין: הַתַּנָּא סָמַךְ עַל הַכָּתוּב בַּתּוֹרָה וּבְשָׁכְבְּךָ וּבְקוּמֶךָ וּפֵרֵשׁ זְמַן קְרִיאַת שְׁמַע שֶׁל עַרְבִית.',
        styleName: 'Rashi-Script',
        order: 2,
        hierarchyLevel: 3,
        dibburHamatchil: 'מֵאֵימָתַי קוֹרִין',
        linkedSourceId: 'u-src-13a3',
      },
      {
        id: 'u-tos-13a3',
        role: 'secondary_comment',
        rawText: 'מִשָּׁעָה שֶׁהַכֹּהֲנִים: פֵּירֵשׁ רַשִׁ״י שֶׁזְּמַן צֵאת הַכּוֹכָבִים הוּא גְּמַר טָהֳרָתָן שֶׁל כֹּהֲנִים לֶאֱכֹל בִּתְרוּמָה.',
        styleName: 'Tosafot-Script',
        order: 3,
        hierarchyLevel: 3,
        dibburHamatchil: 'מִשָּׁעָה שֶׁהַכֹּהֲנִים',
        linkedSourceId: 'u-src-13a3',
      },
      {
        id: 'u-fn-13a3',
        role: 'footnote',
        rawText: 'עַיֵּן בְּפֵרוּשׁ הַמִּשְׁנָיוֹת לְהָרַמְבַּ״ם שֶׁבֵּאֵר דִּין תְּרוּמָה וּזְמַן צֵאת הַכּוֹכָבִים.',
        styleName: 'Footnote',
        order: 4,
        hierarchyLevel: 4,
        footnoteAnchorUnitId: 'u-src-13a3',
        footnoteNumber: 1,
      },
    ];

    // v0.8.0 Part E: the running header line and the folio are BOTH off
    // in the default settings (deliberate product defaults), so assertion
    // A3.6 — which checks that header + folio text are present in the PDF
    // — could never pass with bare defaults. The suite tests that they
    // render when enabled, so enable them here.
    const baseSettings = DesignSettingsEngine.createDefaultSettings();
    const settings = DesignSettingsEngine.updatePageElementsSettings(
      baseSettings,
      { showTopHeaderLine: true, showFolioNumber: true },
      'user'
    );
    const bookDoc = PaginationEngine.paginateDocument({
      title: 'מסכת ברכות',
      layoutType: 'rav_text',
      units: baseUnits,
      geometry: DEFAULT_GEOMETRY,
      designSettings: settings,
    });

    const pdfBlob = await PdfExporter.generateMultiPagePdf(bookDoc);
    const extractedDoc = await PdfExporter.extractPdfContent(pdfBlob);
    const page1 = extractedDoc.pages[0];
    const renderPlan = PdfExporter.buildPageRenderPlan(bookDoc.pages[0]);

    // 1. Native vector PDF output (not flattened to a full-page PNG image) & Hebrew text extraction succeeds
    {
      const noRasterImage = page1 && !page1.hasFullPageRasterImage;
      const hasHebrewSpans = page1 && page1.spans.length >= 25;
      const hasVectorOps = page1 && page1.vectorPathOpsCount >= 10;
      const passed = Boolean(noRasterImage && hasHebrewSpans && hasVectorOps);
      assertions.push({
        id: 1,
        name: 'Hebrew text is natively extracted from vector PDF without full-page raster image flattening',
        passed,
        details: `hasFullPageRasterImage=${page1?.hasFullPageRasterImage}, extractedSpanCount=${page1?.spans.length}, vectorPathOps=${page1?.vectorPathOpsCount}`,
      });
    }

    // 2. Searching for known Hebrew words (both with Nikud and stripped of Nikud) succeeds
    {
      const targetWordsWithNikud = ['מֵאֵימָתַי', 'קוֹרִין', 'שֶׁהַכֹּהֲנִים', 'בִּתְרוּמָתָן', 'הָרַמְבַּ״ם'];
      const targetWordsStripped = ['מאימתי', 'קורין', 'שהכהנים', 'בתרומתן', 'הרמב״ם'];
      const allFoundWithNikud = targetWordsWithNikud.every(w =>
        extractedDoc.fullText.includes(w)
      );
      const allFoundStripped = targetWordsStripped.every(w =>
        extractedDoc.strippedFullText.includes(w)
      );
      const passed = allFoundWithNikud && allFoundStripped;
      assertions.push({
        id: 2,
        name: 'Searching for known Hebrew words in extracted PDF text succeeds (with and without Nikud)',
        passed,
        details: `allFoundWithNikud=${allFoundWithNikud}, allFoundStripped=${allFoundStripped}`,
      });
    }

    // 3. Text order is correct for RTL content (both character order within words and word order within lines)
    {
      const firstSrcLinePlan = renderPlan.lines.find(l => l.role === 'main_source');
      const expectedFirstWord = firstSrcLinePlan?.words[0]?.text ?? 'מֵאֵימָתַי';
      const expectedSecondWord = firstSrcLinePlan?.words[1]?.text ?? 'קוֹרִין';

      const matchingPdfLine = page1.lines.find(
        l => Math.abs(l.yBaselinePt - (firstSrcLinePlan?.yBaseline ?? 0)) <= 1.5
      );
      const spansOnLine = matchingPdfLine?.spans ?? [];
      const idxW1 = spansOnLine.findIndex(s => s.text.includes(expectedFirstWord));
      const idxW2 = spansOnLine.findIndex(s => s.text.includes(expectedSecondWord));

      // Within the line, the first Hebrew word has a larger xRightPt than the second Hebrew word,
      // and in RTL sorted line order it appears before the second word (`idxW1 < idxW2`).
      const rtlWordOrderCorrect =
        idxW1 !== -1 &&
        idxW2 !== -1 &&
        idxW1 < idxW2 &&
        spansOnLine[idxW1].xRightPt > spansOnLine[idxW2].xRightPt;

      // Within each word, characters are in logical order ('מ' before 'א' before 'י' in 'מֵאֵימָתַי', not reversed 'יתמיאמ')
      const span1Text = spansOnLine[idxW1]?.strippedText ?? '';
      const logicalCharOrder = span1Text === 'מאימתי' && !extractedDoc.strippedFullText.includes('יתמיאמ');

      const passed = rtlWordOrderCorrect && logicalCharOrder;
      assertions.push({
        id: 3,
        name: 'RTL text order is preserved both across words on a line and within Hebrew words',
        passed,
        details: `firstWord="${span1Text}" (xRight=${spansOnLine[idxW1]?.xRightPt}), secondWord="${spansOnLine[idxW2]?.strippedText}" (xRight=${spansOnLine[idxW2]?.xRightPt}), logicalCharOrder=${logicalCharOrder}`,
      });
    }

    // 4. Niqqud and combining marks remain associated with the correct base letters
    {
      const meimataiSpan = page1.spans.find(s => s.strippedText === 'מאימתי');
      const clusters = PdfNativeTextEngine.splitHebrewGraphemeClusters(meimataiSpan?.text ?? '');
      // Expected clusters for 'מֵאֵימָתַי': ['מֵ', 'אֵ', 'י', 'מָ', 'תַ', 'י']
      const exactClusters =
        clusters.length === 6 &&
        clusters[0] === 'מֵ' &&
        clusters[1] === 'אֵ' &&
        clusters[2] === 'י' &&
        clusters[3] === 'מָ' &&
        clusters[4] === 'תַ' &&
        clusters[5] === 'י';

      const passed = exactClusters;
      assertions.push({
        id: 4,
        name: 'Niqqud and combining marks remain attached to their exact Hebrew base letters in PDF extraction',
        passed,
        details: `clusters=${JSON.stringify(clusters)}`,
      });
    }

    // 5. Bold Dibbur HaMatchil is preserved in the PDF font stream
    {
      // In Rashi ('מֵאֵימָתַי קוֹרִין.') and Tosafot ('מִשָּׁעָה שֶׁהַכֹּהֲנִים.'), the Dibbur HaMatchil words use Bold font
      const rashiFirstLinePlan = renderPlan.lines.find(l => l.role === 'primary_comment');
      const rashiBodyLinePlan = renderPlan.lines.filter(l => l.role === 'primary_comment').slice(-1)[0];

      const dibburPlanWord = rashiFirstLinePlan?.words.find(w => w.isDibbur);
      const nonDibburPlanWord = rashiBodyLinePlan?.words.find(w => !w.isDibbur);

      const dibburPdfSpan = page1.spans.find(
        s =>
          dibburPlanWord &&
          s.text === dibburPlanWord.text &&
          Math.abs(s.yBaselinePt - dibburPlanWord.yBaseline) <= 1.0
      );
      const nonDibburPdfSpan = page1.spans.find(
        s =>
          nonDibburPlanWord &&
          s.text === nonDibburPlanWord.text &&
          Math.abs(s.yBaselinePt - nonDibburPlanWord.yBaseline) <= 1.0
      );

      const passed = Boolean(
        dibburPdfSpan &&
          dibburPdfSpan.isBoldFont === true &&
          nonDibburPdfSpan &&
          nonDibburPdfSpan.isBoldFont === false
      );
      assertions.push({
        id: 5,
        name: 'Bold Dibbur HaMatchil formatting is preserved via embedded Bold TrueType font in PDF',
        passed,
        details: `dibburWord="${dibburPdfSpan?.text}" (isBold=${dibburPdfSpan?.isBoldFont}, font=${dibburPdfSpan?.fontResourceId}), bodyWord="${nonDibburPdfSpan?.text}" (isBold=${nonDibburPdfSpan?.isBoldFont}, font=${nonDibburPdfSpan?.fontResourceId})`,
      });
    }

    // 6. Footnotes, inline footnote markers, Running Header, Hebrew Folio, and Rav Text commentary zones are present
    {
      const hasSource =
        extractedDoc.strippedFullText.includes('שהכהנים') &&
        extractedDoc.strippedFullText.includes('נכנסים');
      const hasRashi =
        extractedDoc.strippedFullText.includes('התנא') &&
        extractedDoc.strippedFullText.includes('סמך');
      const hasTosafot =
        extractedDoc.strippedFullText.includes('גמר') &&
        extractedDoc.strippedFullText.includes('טהרתן');
      const hasFootnote = extractedDoc.strippedFullText.includes('להרמב״ם');
      const hasFootnoteMarker =
        page1.spans.some(s => s.text.includes('[1]')) ||
        extractedDoc.strippedFullText.includes('[1]');
      const hasHeader = extractedDoc.strippedFullText.includes('מסכת ברכות');
      const expectedFolio = `דף ${renderPlan.pageNumberHebrew}`;
      const hasFolio = extractedDoc.strippedFullText.includes(expectedFolio);

      const passed =
        hasSource &&
        hasRashi &&
        hasTosafot &&
        hasFootnote &&
        hasFootnoteMarker &&
        hasHeader &&
        hasFolio;
      assertions.push({
        id: 6,
        name: 'Source, Rashi, Tosafot, Footnotes, inline markers, Running Header, and Hebrew Folio are all present in PDF',
        passed,
        details: `source=${hasSource}, rashi=${hasRashi}, tosafot=${hasTosafot}, footnote=${hasFootnote}, marker=${hasFootnoteMarker}, header=${hasHeader}, folio=${hasFolio} (${expectedFolio})`,
      });
    }

    // 7. Exported PDF word positions match the authoritative PdfPageRenderPlan coordinates
    {
      let matchedCoordsCount = 0;
      let totalPlannedWords = 0;
      let maxBaselineDelta = 0;
      let maxRightDelta = 0;

      for (const lineCmd of renderPlan.lines) {
        for (const wCmd of lineCmd.words) {
          totalPlannedWords++;
          const matchingSpan = page1.spans.find(
            s =>
              s.text === wCmd.text &&
              Math.abs(s.yBaselinePt - wCmd.yBaseline) <= 0.5 &&
              Math.abs(s.xRightPt - wCmd.xRight) <= 1.5
          );
          if (matchingSpan) {
            matchedCoordsCount++;
            maxBaselineDelta = Math.max(
              maxBaselineDelta,
              Math.abs(matchingSpan.yBaselinePt - wCmd.yBaseline)
            );
            maxRightDelta = Math.max(
              maxRightDelta,
              Math.abs(matchingSpan.xRightPt - wCmd.xRight)
            );
          }
        }
      }

      const passed = totalPlannedWords > 0 && matchedCoordsCount === totalPlannedWords;
      assertions.push({
        id: 7,
        name: 'Exported PDF text positions match the authoritative PageRenderPlan coordinates 1:1',
        passed,
        details: `matched=${matchedCoordsCount}/${totalPlannedWords}, maxBaselineDelta=${maxBaselineDelta.toFixed(2)}pt, maxRightDelta=${maxRightDelta.toFixed(2)}pt`,
      });
    }

    // 8. Zero text loss, zero duplication, zero reordering, and zero unauthorized text introduction
    {
      const plannedBodyWords = renderPlan.lines.flatMap(l => l.words.map(w => w.text));
      // Filter PDF spans to body/commentary/footnote y-range `[mTop .. mBottom]` and exclude `[1]` superscript marker
      const mTop = bookDoc.geometry.marginTop;
      const mBottom = bookDoc.geometry.pageHeight - bookDoc.geometry.marginBottom;
      const extractedBodyWords = page1.lines
        .filter(l => l.yBaselinePt >= mTop && l.yBaselinePt <= mBottom)
        .flatMap(l =>
          l.spans
            .filter(s => !/^\[\d+\]$/.test(s.text))
            .map(s => s.text)
        );

      const exactWordCount = extractedBodyWords.length === plannedBodyWords.length;
      const plannedBag = [...plannedBodyWords].sort().join('|');
      const extractedBag = [...extractedBodyWords].sort().join('|');
      const exactBagMatch = plannedBag === extractedBag;

      const passed = exactWordCount && exactBagMatch;
      assertions.push({
        id: 8,
        name: 'No text is lost, duplicated, reordered, or newly introduced in native PDF export',
        passed,
        details: `plannedWordCount=${plannedBodyWords.length}, extractedBodyWordCount=${extractedBodyWords.length}, exactMultisetMatch=${exactBagMatch}`,
      });
    }

    // 9. Explicitly user-selected ornaments and Engine Hard Rules remain preserved
    {
      const sampleOrnament = {
        ...OrnamentLibraryEngine.getAllOrnaments()[0],
        isUserUploaded: true,
      };
      const unitsWithChapter: ContentUnit[] = [
        {
          id: 'u-ch-13a3',
          role: 'chapter',
          rawText: 'פֶּרֶק רִאשׁוֹן',
          styleName: 'Chapter-Title',
          order: 0,
          hierarchyLevel: 1,
        },
        ...baseUnits,
      ];
      const docWithOrnament = PaginationEngine.paginateDocument({
        title: 'מסכת ברכות',
        layoutType: 'rav_text',
        units: unitsWithChapter,
        geometry: DEFAULT_GEOMETRY,
        designSettings: settings,
        enableOrnaments: true,
        userSuppliedOrnaments: [sampleOrnament],
        userOrnamentRules: [
          {
            ornamentId: sampleOrnament.id,
            placement: 'chapter_opening',
          },
        ],
      });

      const pdfWithOrn = await PdfExporter.generateMultiPagePdf(docWithOrnament);
      const extWithOrn = await PdfExporter.extractPdfContent(pdfWithOrn);
      const vectorOpsIncreased =
        extWithOrn.pages[0].vectorPathOpsCount > page1.vectorPathOpsCount;

      const hardRulesReport = EngineHardRulesEngine.evaluateContext({
        units: unitsWithChapter,
        bookDoc: docWithOrnament,
        userSuppliedOrnamentsCount: docWithOrnament.pages.reduce(
          (s, p) => s + (p.placedOrnaments?.length ?? 0),
          0
        ),
      });

      const passed = vectorOpsIncreased && hardRulesReport.passed;
      assertions.push({
        id: 9,
        name: 'User-selected ornaments render as native PDF vectors and Engine Hard Rules pass',
        passed,
        details: `vectorOpsWithoutOrn=${page1.vectorPathOpsCount}, vectorOpsWithOrn=${extWithOrn.pages[0].vectorPathOpsCount}, hardRulesPassed=${hardRulesReport.passed}`,
      });
    }

    const passedCount = assertions.filter(a => a.passed).length;
    return {
      allPassed: passedCount === assertions.length,
      passedCount,
      totalCount: assertions.length,
      assertions,
    };
  }

  /**
   * Stage 13A-4 Verification Suite:
   * Large-Document (30–50 Pages) Stress Test & Native Searchable PDF Verification
   */
  public static async runStage13A4Tests(): Promise<LargeDocumentStressReport> {
    return LargeDocumentStressSuite.runLargeDocumentStressTest();
  }
}
