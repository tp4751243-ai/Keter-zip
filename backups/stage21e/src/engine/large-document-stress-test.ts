/**
 * STAGE 13A-4 — LARGE-DOCUMENT STRESS TEST FIXTURE & VERIFICATION SUITE
 *
 * Provides a substantial, deterministic, reproducible Hebrew Sefer fixture ("מסכת ברכות — מהדורת מבחן מאמץ רב-עמודית")
 * designed to span 35–48 pages under the default Rav Text ("ברכיים") settings WITHOUT modifying
 * any pagination or Rav Text algorithms.
 *
 * Explicitly separates and marks:
 * 1. Authentic classical vocalized source passages (Mishnah/Gemara Berakhot & Chumash Bereishit with Niqqud and Taamim).
 * 2. Deterministic structured sugyot & commentaries clearly labeled with section/sugya markers so test content
 *    is transparently distinguished from canonical text while exercising:
 *    - Continuous Hebrew source text with Niqqud and Taamim (cantillation marks).
 *    - Extensive linked Rashi (`primary_comment`) and Tosafot (`secondary_comment`) commentary.
 *    - Both short (1–2 words) and long (6–10 words) Dibbur HaMatchil lead phrases.
 *    - Multiple commentaries (2–4 Rashi units + 2–3 Tosafot units) linked to the same source passage.
 *    - Footnotes of varying lengths, including short citations, medium notes, and multi-page-continuing long footnotes (>120 words).
 *    - Chapter headings, Siman subheadings, paragraph boundaries, and cross-page continuations.
 *    - Dense commentary sections, balanced sections, and source-heavy/sparse-commentary sections creating diverse Rav Text knee contours.
 */

import {
  BookTypesetDocument,
  ContentUnit,
  PageGeometry,
  RavTextLink,
} from '../types/typesetter';
import { DesignSettingsEngine } from './design-settings-engine';
import { DocxImporter } from './docx-importer';
import { EngineHardRulesEngine } from './engine-hard-rules';
import { PaginationEngine } from './pagination-engine';
import { PdfExporter } from './pdf-exporter';
import { PdfNativeTextEngine } from './pdf-native-text-engine';
import { QaEngine } from './qa-engine';
import { SpatialExclusionEngine } from './spatial-exclusion';

export interface LargeSeferFixture {
  title: string;
  units: ContentUnit[];
  links: RavTextLink[];
  metadata: {
    chapterCount: number;
    sourceUnitCount: number;
    rashiUnitCount: number;
    tosafotUnitCount: number;
    footnoteUnitCount: number;
    headingUnitCount: number;
    authenticUnitIds: string[];
    syntheticTestUnitIds: string[];
    shortDibburCount: number;
    longDibburCount: number;
    multiCommentarySourceCount: number;
    longFootnoteIds: string[];
  };
}

export interface PageStressMetrics {
  pageNumber: number;
  pageNumberHebrew: string;
  sourceLineCount: number;
  rashiLineCount: number;
  tosafotLineCount: number;
  footnoteLineCount: number;
  totalLineCount: number;
  sourceWordCount: number;
  rashiWordCount: number;
  tosafotWordCount: number;
  footnoteWordCount: number;
  utilizationPercent: number;
  occupiedAreaRatioPercent: number;
  verticalSpanRatioPercent: number;
  collisionCount: number;
  clippingCount: number;
  rtlViolationCount: number;
  orphanMarkCount: number;
  footnoteOverlapCount: number;
  hasChapterHeading: boolean;
  isDocumentEndingPage: boolean;
  isBeforeChapterOpening: boolean;
  sparseClassification:
    | 'normal'
    | 'legitimate_document_ending'
    | 'legitimate_chapter_transition'
    | 'suspicious_sparse_defect';
}

export interface LargeDocumentStressReport {
  documentTitle: string;
  pageCount: number;
  totalExpectedWords: {
    source: number;
    rashi: number;
    tosafot: number;
    footnotes: number;
    total: number;
  };
  totalPlacedWords: {
    source: number;
    rashi: number;
    tosafot: number;
    footnotes: number;
    total: number;
  };
  conservation: {
    sourceConserved100Percent: boolean;
    rashiConserved100Percent: boolean;
    tosafotConserved100Percent: boolean;
    footnotesConserved100Percent: boolean;
    exactWordSequencePreserved: boolean;
    missingWordsCount: number;
    duplicatedWordsCount: number;
    reorderedWordsCount: number;
  };
  links: {
    totalDefinedLinks: number;
    activeLinksAcrossPages: number;
    samePageLinksCount: number;
    crossPageContinuationLinksCount: number;
    brokenLinksCount: number;
    allLinksIntact: boolean;
  };
  geometryAndSafety: {
    totalCollisions: number;
    totalClippingIssues: number;
    totalRtlViolations: number;
    totalOrphanMarks: number;
    totalFootnoteOverlaps: number;
    engineHardRulesPassed: boolean;
    qaPreflightPassed: boolean;
  };
  utilization: {
    meanUtilizationPercent: number;
    medianUtilizationPercent: number;
    minUtilizationPercent: number;
    maxUtilizationPercent: number;
    stdDevUtilizationPercent: number;
    meanVerticalSpanPercent: number;
    normalPagesCount: number;
    legitimateEndingOrChapterPagesCount: number;
    suspiciousSparsePagesCount: number;
    suspiciousSparsePageNumbers: number[];
  };
  pdfVerification: {
    pdfByteSize: number;
    extractedPageCount: number;
    noFullPageRasterImages: boolean;
    extractedTotalSpanCount: number;
    extractedBodyWordCount: number;
    searchQueriesTested: number;
    searchQueriesSucceeded: number;
    allSearchQueriesPassed: boolean;
    niqqudQueriesPassed: boolean;
    taamimQueriesPassed: boolean;
    boldDibburSpanCount: number;
    coordinateSampleMatchedCount: number;
    coordinateSampleTotalCount: number;
  };
  pageMetrics: PageStressMetrics[];
  failures: string[];
  allPassed: boolean;
}

const DEFAULT_STRESS_GEOMETRY: PageGeometry = {
  pageWidth: 482,
  pageHeight: 680,
  marginTop: 48,
  marginBottom: 48,
  marginInside: 46,
  marginOutside: 42,
  isVerso: false,
};

export class LargeDocumentStressSuite {
  /**
   * Builds a deterministic, reproducible 35–48 page Hebrew Sefer fixture with:
   * - 5 Chapters (פרק ראשון .. פרק חמישי) and 22 Sugyot/Simanim
   * - Authentic vocalized Mishnah/Gemara & Biblical verses with Niqqud and Taamim
   * - Deterministic synthetic analytical extensions explicitly tagged by sugya/section number
   * - Short and long Dibbur HaMatchil phrases
   * - Multiple Rashi and Tosafot units linked to the same source passage
   * - Short, medium, and multi-page-continuing long footnotes
   * - Varied density profiles (commentary-heavy, balanced, and source-heavy/sparse-commentary)
   */
  public static buildLargeSeferFixture(): LargeSeferFixture {
    const units: ContentUnit[] = [];
    const links: RavTextLink[] = [];
    const authenticUnitIds: string[] = [];
    const syntheticTestUnitIds: string[] = [];
    const longFootnoteIds: string[] = [];
    let order = 0;
    let fnCounter = 0;
    let shortDibburCount = 0;
    let longDibburCount = 0;
    let multiCommentarySourceCount = 0;

    // Canonical vocalized building blocks with Niqqud and Taamim (cantillation marks)
    const authenticSeeds = [
      {
        mishnah:
          'מתניתין: מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן, עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה, דִּבְרֵי רַבִּי אֱלִיעֶזֶר. וַחֲכָמִים אוֹמְרִים: עַד חֲצוֹת. רַבָּן גַּמְלִיאֵל אוֹמֵר: עַד שֶׁיַּעֲלֶה עַמּוּד הַשָּׁחַר.',
        scriptureWithTaamim:
          'כַּכָּתוּב בַּתּוֹרָה: שְׁמַ֖ע יִשְׂרָאֵ֑ל יְהוָ֥ה אֱלֹהֵ֖ינוּ יְהוָ֥ה אֶחָֽד׃ וְאָ֣הַבְתָּ֔ אֵ֖ת יְהוָ֣ה אֱלֹהֶ֑יךָ בְּכָל־לְבָבְךָ֥ וּבְכָל־נַפְשְׁךָ֖ וּבְכָל־מְאֹדֶֽךָ׃ וְהָי֞וּ הַדְּבָרִ֣ים הָאֵ֗לֶּה אֲשֶׁ֨ר אָנֹכִ֧י מְצַוְּךָ֛ הַיּ֖וֹם עַל־לְבָבֶֽךָ׃ וְשִׁנַּנְתָּ֣ם לְבָנֶ֔יךָ וְדִבַּרְתָּ֖ בָּ֑ם בְּשִׁבְתְּךָ֤ בְּבֵיתֶ֙ךָ֙ וּבְלֶכְתְּךָ֣ בַדֶּ֔רֶךְ וּבְשָׁכְבְּךָ֖ וּבְקוּמֶֽךָ׃',
        shortDibbur1: 'מֵאֵימָתַי',
        shortDibbur2: 'עַד חֲצוֹת',
        longDibbur1: 'מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכֹל בִּתְרוּמָתָן עַד סוֹף הָאַשְׁמוּרָה',
        longDibbur2: 'וְשִׁנַּנְתָּם לְבָנֶיךָ וְדִבַּרְתָּ בָּם בְּשִׁבְתְּךָ בְּבֵיתֶךָ וּבְלֶכְתְּךָ בַדֶּרֶךְ',
      },
      {
        mishnah:
          'גמרא: תָּנָא הֵיכָא קָאֵי דְּקָתָנֵי מֵאֵימָתַי? וְתוּ, מַאי שְׁנָא דְּתָנֵי דְּעַרְבִית בְּרֵישָׁא, לִתְנֵי דְּשַׁחֲרִית בְּרֵישָׁא! תַּנָּא אַקְּרָא קָאֵי, דִּכְתִיב בְּשָׁכְבְּךָ וּבְקוּמֶךָ, וְהָכִי קָתָנֵי: זְמַן קְרִיאַת שְׁמַע דִּשְׁכִיבָה אֵימַת — מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִין לֶאֱכֹל בִּתְרוּמָתָן.',
        scriptureWithTaamim:
          'דִּכְתִיב בְּמַעֲשֵׂה בְּרֵאשִׁית: בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃ וַיֹּ֥אמֶר אֱלֹהִ֖ים יְהִ֣י א֑וֹר וַֽיְהִי־אֽוֹר׃ וַיַּ֧רְא אֱלֹהִ֛ים אֶת־הָא֖וֹר כִּי־ט֑וֹב וַיַּבְדֵּ֣ל אֱלֹהִ֔ים בֵּ֥ין הָא֖וֹר וּבֵ֥ין הַחֹֽשֶׁךְ׃ וַיִּקְרָ֨א אֱלֹהִ֤ים לָאוֹר֙ י֔וֹם וְלַחֹ֖שֶׁךְ קָ֣רָא לָ֑יְלָה וַֽיְהִי־עֶ֥רֶב וַֽיְהִי־בֹ֖קֶר י֥וֹם אֶחָֽד׃',
        shortDibbur1: 'הֵיכָא קָאֵי',
        shortDibbur2: 'אַקְּרָא קָאֵי',
        longDibbur1: 'וְתוּ מַאי שְׁנָא דְּתָנֵי דְּעַרְבִית בְּרֵישָׁא לִתְנֵי דְּשַׁחֲרִית בְּרֵישָׁא',
        longDibbur2: 'וַיִּקְרָא אֱלֹהִים לָאוֹר יוֹם וְלַחֹשֶׁךְ קָרָא לָיְלָה וַיְהִי עֶרֶב',
      },
      {
        mishnah:
          'מתניתין: מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּשַׁחֲרִית? מִשֶּׁיַּכִּיר בֵּין תְּכֵלֶת לְלָבָן. רַבִּי אֱלִיעֶזֶר אוֹמֵר: בֵּין תְּכֵלֶת לְכַרְתִּי. וְגוֹמְרָהּ עַד הָנֵץ הַחַמָּה. רַבִּי יְהוֹשֻׁעַ אוֹמֵר: עַד שָׁלֹשׁ שָׁעוֹת, שֶׁכֵּן דֶּרֶךְ בְּנֵי מְלָכִים לַעֲמֹד בְּשָׁלֹשׁ שָׁעוֹת.',
        scriptureWithTaamim:
          'כְּדִכְתִיב בְּפָרָשַׁת צִיצִית: וַיֹּ֥אמֶר יְהוָ֖ה אֶל־מֹשֶׁ֥ה לֵּאמֹֽר׃ דַּבֵּ֞ר אֶל־בְּנֵ֤י יִשְׂרָאֵל֙ וְאָמַרְתָּ֣ אֲלֵהֶ֔ם וְעָשׂ֨וּ לָהֶם צִיצִ֛ת עַל־כַּנְפֵ֥י בִגְדֵיהֶ֖ם לְדֹרֹתָ֑ם וְנָֽתְנ֛וּ עַל־צִיצִ֥ת הַכָּנָ֖ף פְּתִ֥יל תְּכֵֽלֶת׃ וְהָיָה לָכֶם לְצִיצִת וּרְאִיתֶ֣ם אֹת֗וֹ וּזְכַרְתֶּם֙ אֶת־כָּל־מִצְוֹ֣ת יְהוָ֔ה וַעֲשִׂיתֶ֖ם אֹתָֽם׃',
        shortDibbur1: 'בֵּין תְּכֵלֶת',
        shortDibbur2: 'הָנֵץ הַחַמָּה',
        longDibbur1: 'רַבִּי יְהוֹשֻׁעַ אוֹמֵר עַד שָׁלֹשׁ שָׁעוֹת שֶׁכֵּן דֶּרֶךְ בְּנֵי מְלָכִים',
        longDibbur2: 'וְנָתְנוּ עַל צִיצִת הַכָּנָף פְּתִיל תְּכֵלֶת וּרְאִיתֶם אֹתוֹ וּזְכַרְתֶּם',
      },
      {
        mishnah:
          'גמרא: תָּנוּ רַבָּנַן, קְרִיאַת שְׁמַע כִּכְתָבָהּ, דִּבְרֵי רַבִּי, וַחֲכָמִים אוֹמְרִים בְּכָל לָשׁוֹן. מַאי טַעְמָא דְּרַבִּי? אָמַר קְרָא וְהָיוּ, בַּהֲוָיָתָן יְהוּ. וְרַבָּנַן מַאי טַעְמַיְיהוּ? אָמַר קְרָא שְׁמַע, בְּכָל לָשׁוֹן שֶׁאַתָּה שׁוֹמֵעַ.',
        scriptureWithTaamim:
          'וּכְתִיב בְּמִשְׁנֵה תוֹרָה: הַסְכֵּ֤ת וּשְׁמַע֙ יִשְׂרָאֵ֔ל הַיּוֹם הַזֶּה נִהְיֵ֥יתָ לְעָ֖ם לַיהוָ֣ה אֱלֹהֶ֑יךָ וְשָׁמַעְתָּ֗ בְּקוֹל֙ יְהוָ֣ה אֱלֹהֶ֔יךָ וְעָשִׂיתָ֙ אֶת־מִצְוֹתָ֣יו וְאֶת־חֻקָּ֔יו אֲשֶׁר אָנֹכִי מְצַוְּךָ֖ הַיּֽוֹם׃',
        shortDibbur1: 'כִּכְתָבָהּ',
        shortDibbur2: 'בַּהֲוָיָתָן יְהוּ',
        longDibbur1: 'וַחֲכָמִים אוֹמְרִים בְּכָל לָשׁוֹן מַאי טַעְמָא דְּרַבָּנַן אָמַר קְרָא שְׁמַע',
        longDibbur2: 'הַסְכֵּת וּשְׁמַע יִשְׂרָאֵל הַיּוֹם הַזֶּה נִהְיֵיתָ לְעָם לַיהוָה אֱלֹהֶיךָ',
      },
    ];

    const chapterTitles = [
      'פֶּרֶק רִאשׁוֹן — מֵאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִית',
      'פֶּרֶק שֵׁנִי — הָיָה קוֹרֵא בַּתּוֹרָה וְהִגִּיעַ זְמַן הַמִּקְרָא',
      'פֶּרֶק שְׁלִישִׁי — מִי שֶׁמֵּתוֹ מוּטָל לְפָנָיו וְדִינֵי קְרִיאַת שְׁמַע',
      'פֶּרֶק רְבִיעִי — תְּפִלַּת הַשַּׁחַר וּתְפִלַּת הַמִּנְחָה וְהָעַרְבִית',
      'פֶּרֶק חֲמִישִׁי — אֵין עוֹמְדִין לְהִתְפַּלֵּל אֶלָּא מִתּוֹךְ כֹּבֶד רֹאשׁ',
    ];

    const hebrewLetters = [
      'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י',
      'יא', 'יב', 'יג', 'יד', 'טו', 'טז', 'יז', 'יח', 'יט', 'כ',
      'כא', 'כב', 'כג', 'כד', 'כה',
    ];

    // Profiles per sugya to test diverse Rav Text knee contours:
    // - 'commentary_heavy': Short/medium source + very extensive Rashi & Tosafot (deep knees & wide bottom wraps)
    // - 'balanced': Full source + substantial multi-unit Rashi & Tosafot
    // - 'source_heavy': Long source + concise commentary (wide central source column)
    const densityProfiles: Array<'commentary_heavy' | 'balanced' | 'source_heavy'> = [
      'balanced',
      'commentary_heavy',
      'balanced',
      'source_heavy',
      'commentary_heavy',
    ];

    let globalSugyaIndex = 0;

    for (let chIdx = 0; chIdx < chapterTitles.length; chIdx++) {
      const chId = `stress-ch-${chIdx + 1}`;
      units.push({
        id: chId,
        role: 'chapter',
        rawText: chapterTitles[chIdx],
        styleName: 'Chapter-Title',
        order: ++order,
        hierarchyLevel: 1,
        chapterTitle: chapterTitles[chIdx],
      });
      authenticUnitIds.push(chId);

      // 9 sugyot per chapter = 45 full sugyot across 5 chapters (~35-42 pages in Rav-Text)
      for (let sInCh = 0; sInCh < 9; sInCh++) {
        globalSugyaIndex++;
        const sugyaLetter = hebrewLetters[(globalSugyaIndex - 1) % hebrewLetters.length];
        const seed = authenticSeeds[(globalSugyaIndex - 1) % authenticSeeds.length];
        const profile = densityProfiles[(globalSugyaIndex - 1) % densityProfiles.length];

        // Add a Siman/Section heading unit before every second sugya to test heading keep-with-next and hierarchy
        if (sInCh % 2 === 1) {
          const simanId = `stress-siman-${globalSugyaIndex}`;
          units.push({
            id: simanId,
            role: 'chapter',
            rawText: `סִימָן ${sugyaLetter} — בֵּאוּר סוּגְיָא ${sugyaLetter} בְּפֶרֶק ${hebrewLetters[chIdx]}`,
            styleName: 'Heading 2',
            order: ++order,
            hierarchyLevel: 2,
            parentId: chId,
          });
          syntheticTestUnitIds.push(simanId);
        }

        const srcId = `stress-src-${globalSugyaIndex}`;
        // Build source text: authentic Mishnah/Gemara + authentic Scripture with Taamim + deterministic sugya discussion
        const sourceExpansion =
          profile === 'source_heavy'
            ? ` בְּסוּגְיָא ${sugyaLetter} שָׁקְלוּ וְטָרְוּ בְּנֵי הַיְּשִׁיבָה בְּגִדְרֵי חוֹבַת קְרִיאַת שְׁמַע וּזְמַנֶּיהָ מִן הַתּוֹרָה וּמִדִּבְרֵי סוֹפְרִים, וּבֵרְרוּ אֶת חִלּוּקֵי הַדִּינִים בֵּין תְּחִלַּת הַזְּמַן לְסוֹף הַזְּמַן וּבֵין יָחִיד לְצִבּוּר בְּכָל פְּרָטֵי הַהֲלָכוֹת הַמִּסְתַּעֲפוֹת מִן הַמִּשְׁנָה וְהַבְּרַיְתָא. וְעוֹד הוֹסִיפוּ לְדַקְדֵּק בִּלְשׁוֹן הַכָּתוּב וּבְטַעֲמֵי הַמִּקְרָא הַמּוֹרִים עַל סֵדֶר הַפָּרָשִׁיּוֹת וְעַל קַבָּלַת עֹל מַלְכוּת שָׁמַיִם בְּכַוָּנַת הַלֵּב.`
            : profile === 'balanced'
            ? ` בְּסוּגְיָא ${sugyaLetter} אָמַר רַב יְהוּדָה אָמַר שְׁמוּאֵל: הֲלָכָה כְּדִבְרֵי חֲכָמִים שֶׁגָּדְרוּ סְיָג לַתּוֹרָה, וְהַקּוֹרֵא קְרִיאַת שְׁמַע בְּעִתָּהּ מְקַיֵּם מִצְוַת עֲשֵׂה שֶׁל תּוֹרָה בְּהִדּוּר.`
            : ` בְּסוּגְיָא ${sugyaLetter} קָא מַשְׁמַע לַן הֲלָכָה לְמַעֲשֶׂה.`;

        const rawSourceText = `${seed.mishnah} ${seed.scriptureWithTaamim}${sourceExpansion}`;

        // Attach footnote anchor(s) on this source unit
        const hasFootnoteOnSource = globalSugyaIndex % 2 === 1;
        const isLongMultiPageFootnote =
          globalSugyaIndex === 3 ||
          globalSugyaIndex === 11 ||
          globalSugyaIndex === 19 ||
          globalSugyaIndex === 27 ||
          globalSugyaIndex === 35;
        const currentFnNum = hasFootnoteOnSource ? ++fnCounter : undefined;
        const currentFnId = hasFootnoteOnSource ? `stress-fn-${currentFnNum}` : undefined;

        const baseRuns = DocxImporter.buildRunsFromRawText(rawSourceText, 'main_source');
        // Attach the footnote reference to the lead run (first word of the source unit)
        // so the footnote is triggered immediately on the first page where this source unit starts!
        if (currentFnNum && currentFnId && baseRuns.length > 0) {
          const leadRun = baseRuns[0];
          leadRun.footnoteMarker = currentFnNum;
          leadRun.footnoteUnitId = currentFnId;
        }

        units.push({
          id: srcId,
          role: 'main_source',
          rawText: rawSourceText,
          textRuns: baseRuns,
          styleName: 'Gemara-Source',
          order: ++order,
          hierarchyLevel: 2,
          parentId: chId,
        });
        authenticUnitIds.push(srcId);

        // Multiple commentaries linked to the SAME source unit (`srcId`):
        // - 2 Rashi units (1 short Dibbur HaMatchil, 1 long Dibbur HaMatchil)
        // - 2 Tosafot units (1 short Dibbur HaMatchil, 1 long Dibbur HaMatchil)
        // Plus a 3rd Rashi unit on `commentary_heavy` sugyot, and an extra-long multi-page sugya on `sInCh === 4`
        const isMultiPageOverflowSugya = sInCh === 4;
        multiCommentarySourceCount++;

        const rashi1Id = `stress-rashi-${globalSugyaIndex}-a`;
        const rashi1Body =
          profile === 'commentary_heavy' || isMultiPageOverflowSugya
            ? `פירוש רש״י לסוגיא ${sugyaLetter} אות א: פֵּרֵשׁ הַתַּנָּא זְמַן קְרִיאַת שְׁמַע עַל פִּי זְמַן אֲכִילַת תְּרוּמָה לַכֹּהֲנִים שֶׁטָּבְלוּ בַּיּוֹם וְהֶעֱרִיב שִׁמְשָׁן, לְלַמְּדֵנוּ דְּבִיאַת הַשֶּׁמֶשׁ הִיא צֵאת הַכּוֹכָבִים וְהִיא מְעַכֶּבֶת בָּאֲכִילָה וְאֵין הֲבָאַת כַּפָּרָתוֹ בַּיּוֹם הַשְּׁמִינִי מְעַכַּבְתּוֹ מִלֶּאֱכֹל בִּתְרוּמָה. וּבְסוּגְיָא ${sugyaLetter} הוֹסִיפוּ הַמְּפָרְשִׁים לְבָאֵר כִּי שְׁלֹשָׁה כּוֹכָבִים בֵּינוֹנִיִּים הֵם הַסִּימָן הַמֻּבְהָק לְצֵאת הַכּוֹכָבִים בְּכָל מָקוֹם וּבְכָל עֵת.` +
              (isMultiPageOverflowSugya
                ? ` וְעוֹד הֶאֱרִיךְ רַשִׁ״י בְּבֵאוּר חִלּוּקֵי הַזְּמַנִּים בֵּין תְּחִלַּת הָאַשְׁמוּרָה הָרִאשׁוֹנָה לְסוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה וּבֵין חֲצוֹת הַלַּיְלָה לַעֲלוֹת הַשַּׁחַר, וּבֵאֵר כִּי כָּל מָקוֹם שֶׁאָמְרוּ חֲכָמִים עַד חֲצוֹת הוּא כְּדֵי לְהַרְחִיק אֶת הָאָדָם מִן הָעֲבֵרָה.`
                : '')
            : `פירוש רש״י לסוגיא ${sugyaLetter} אות א: מֵאֵיזֶה זְמַן מַתְחִיל חִיּוּב הַקְּרִיאָה, וְתָלָה הַתַּנָּא אֶת הַדָּבָר בְּצֵאת הַכּוֹכָבִים שֶׁהוּא גְּמַר טָהֳרַת הַכֹּהֲנִים לֶאֱכֹל בִּתְרוּמָתָן.`;
        const rashi1Raw = `${seed.shortDibbur1}: ${rashi1Body}`;
        units.push({
          id: rashi1Id,
          role: 'primary_comment',
          rawText: rashi1Raw,
          styleName: 'Rashi-Script',
          order: ++order,
          hierarchyLevel: 3,
          parentId: chId,
          dibburHamatchil: seed.shortDibbur1,
          linkedSourceId: srcId,
        });
        links.push({
          linkId: `link-${rashi1Id}-${srcId}`,
          sourceUnitId: srcId,
          commentaryUnitId: rashi1Id,
          dibburHamatchil: seed.shortDibbur1,
          isUserLocked: true,
          confidenceScore: 0.99,
          sourceSnippet: rawSourceText.substring(0, 60),
          commentarySnippet: rashi1Raw.substring(0, 60),
          commentaryType: 'Rashi',
        });
        shortDibburCount++;
        syntheticTestUnitIds.push(rashi1Id);

        const rashi2Id = `stress-rashi-${globalSugyaIndex}-b`;
        const rashi2Body =
          profile === 'source_heavy'
            ? `פירוש רש״י לסוגיא ${sugyaLetter} אות ב: סָמַךְ הַתַּנָּא עַל פְּשׁוּטוֹ שֶׁל מִקְרָא בְּפָרָשַׁת וָאֶתְחַנַּן.`
            : `פירוש רש״י לסוגיא ${sugyaLetter} אות ב: עַל הַמִּקְרָא הַכָּתוּב בַּתּוֹרָה הוּא נִסְמָךְ, שֶׁהִקְדִּים הַכָּתוּב זְמַן שְׁכִיבָה לִזְמַן קִימָה כְּמוֹ שֶׁמָּצִינוּ בְּמַעֲשֵׂה בְּרֵאשִׁית שֶׁהַלַּיְלָה קוֹדֵם לַיּוֹם, וּמִשּׁוּם הָכִי פָּתַח הַתַּנָּא בְּדִינֵי עַרְבִית תְּחִלָּה קֹדֶם שֶׁבֵּאֵר דִּינֵי שַׁחֲרִית וּבִרְכוֹתֶיהָ.`;
        const rashi2Raw = `${seed.longDibbur1}: ${rashi2Body}`;
        units.push({
          id: rashi2Id,
          role: 'primary_comment',
          rawText: rashi2Raw,
          styleName: 'Rashi-Script',
          order: ++order,
          hierarchyLevel: 3,
          parentId: chId,
          dibburHamatchil: seed.longDibbur1,
          linkedSourceId: srcId,
        });
        links.push({
          linkId: `link-${rashi2Id}-${srcId}`,
          sourceUnitId: srcId,
          commentaryUnitId: rashi2Id,
          dibburHamatchil: seed.longDibbur1,
          isUserLocked: true,
          confidenceScore: 0.99,
          sourceSnippet: rawSourceText.substring(0, 60),
          commentarySnippet: rashi2Raw.substring(0, 60),
          commentaryType: 'Rashi',
        });
        longDibburCount++;
        syntheticTestUnitIds.push(rashi2Id);

        if (profile === 'commentary_heavy' || isMultiPageOverflowSugya) {
          const rashi3Id = `stress-rashi-${globalSugyaIndex}-c`;
          const rashi3Raw = `${seed.shortDibbur2}: פירוש רש״י לסוגיא ${sugyaLetter} אות ג: חֲכָמִים עָשׂוּ סְיָג לַתּוֹרָה כְּדֵי שֶׁלֹּא יָבוֹא הָאָדָם מִבֵּית הַשָּׂדֶה בָּעֶרֶב וְיֹאמַר אוֹכַל קִמְעָא וְאֶשְׁתֶּה קִמְעָא וְאִישַׁן קִמְעָא וְאַחַר כָּךְ אֶקְרָא קְרִיאַת שְׁמַע, וְתַחְטְפֶנּוּ שֵׁנָה וְנִמְצָא יָשֵׁן כָּל הַלַּיְלָה עַד שֶׁיַּעֲלֶה עַמּוּד הַשַּׁחַר וִיבַטֵּל מִצְוַת עֲשֵׂה.` +
            (isMultiPageOverflowSugya
              ? ` וְלָכֵן הִקְפִּידוּ חֲכָמִים שֶׁיִּקְרָא הָאָדָם קְרִיאַת שְׁמַע מִיָּד בְּבוֹאוֹ לְבֵיתוֹ קֹדֶם סְעוּדָתוֹ וְלֹא יִסְמֹךְ עַל שְׁעוֹת הַלַּיְלָה הַמְאֻחָרוֹת.`
              : '');
          units.push({
            id: rashi3Id,
            role: 'primary_comment',
            rawText: rashi3Raw,
            styleName: 'Rashi-Script',
            order: ++order,
            hierarchyLevel: 3,
            parentId: chId,
            dibburHamatchil: seed.shortDibbur2,
            linkedSourceId: srcId,
          });
          links.push({
            linkId: `link-${rashi3Id}-${srcId}`,
            sourceUnitId: srcId,
            commentaryUnitId: rashi3Id,
            dibburHamatchil: seed.shortDibbur2,
            isUserLocked: true,
            confidenceScore: 0.99,
            sourceSnippet: rawSourceText.substring(0, 60),
            commentarySnippet: rashi3Raw.substring(0, 60),
            commentaryType: 'Rashi',
          });
          shortDibburCount++;
          syntheticTestUnitIds.push(rashi3Id);
        }

        // Tosafot units linked to the same source unit (`srcId`)
        const tos1Id = `stress-tos-${globalSugyaIndex}-a`;
        const tos1Body =
          profile === 'commentary_heavy' || isMultiPageOverflowSugya
            ? `תוספות לסוגיא ${sugyaLetter} אות א: הִקְשׁוּ בְּבֵית מִדְרָשׁוֹ שֶׁל רַבֵּנוּ תָּם וְרִבָּ״ם דְּאֵיךְ מָצִינוּ בַּגְּמָרָא דְּצִבּוּר הָיוּ מִתְפַּלְּלִין תְּפִלַּת עַרְבִית מִבְּעוֹד יוֹם קֹדֶם צֵאת הַכּוֹכָבִים, וְתֵרְצוּ דְּקַיְימָא לָן כְּרַבִּי יְהוּדָה דִּזְמַן תְּפִלַּת הַמִּנְחָה עַד פְּלַג הַמִּנְחָה וּמִשָּׁם וָאֵילָךְ נִכְנָס זְמַן עַרְבִית, וּמִיהוּ קְרִיאַת שְׁמַע דְּאוֹרַיְתָא חוֹבָתָהּ לַחֲזֹר וְלִקְרוֹתָהּ בְּבֵיתוֹ לְאַחַר צֵאת הַכּוֹכָבִים.` +
              (isMultiPageOverflowSugya
                ? ` וְהֵבִיאוּ רְאָיָה מִמַּעֲשֶׂה דְּרַבָּן גַּמְלִיאֵל וּבָנָיו וּמִסּוּגְיַת הַגְּמָרָא בְּפֶרֶק תְּפִלַּת הַשַּׁחַר דְּתַרְתֵּי דְּסָתְרֵי אַהֲדָדֵי לָא עָבְדִינַן בְּיוֹם אֶחָד.`
                : '')
            : `תוספות לסוגיא ${sugyaLetter} אות א: וְיֵשׁ לְדַקְדֵּק מִפְּנֵי מָה פָּתַח הַתַּנָּא בְּהִלְכוֹת קְרִיאַת שְׁמַע קֹדֶם הִלְכוֹת תְּפִלָּה, וְתֵרֵץ רִבָּ״ם מִשּׁוּם דִּקְרִיאַת שְׁמַע דְּאוֹרַיְתָא עֲדִיפָא לֵיהּ.`;
        const tos1Raw = `${seed.shortDibbur2}: ${tos1Body}`;
        units.push({
          id: tos1Id,
          role: 'secondary_comment',
          rawText: tos1Raw,
          styleName: 'Tosafot-Square',
          order: ++order,
          hierarchyLevel: 3,
          parentId: chId,
          dibburHamatchil: seed.shortDibbur2,
          linkedSourceId: srcId,
        });
        links.push({
          linkId: `link-${tos1Id}-${srcId}`,
          sourceUnitId: srcId,
          commentaryUnitId: tos1Id,
          dibburHamatchil: seed.shortDibbur2,
          isUserLocked: true,
          confidenceScore: 0.99,
          sourceSnippet: rawSourceText.substring(0, 60),
          commentarySnippet: tos1Raw.substring(0, 60),
          commentaryType: 'Tosafot',
        });
        shortDibburCount++;
        syntheticTestUnitIds.push(tos1Id);

        const tos2Id = `stress-tos-${globalSugyaIndex}-b`;
        const tos2Body =
          profile === 'source_heavy'
            ? `תוספות לסוגיא ${sugyaLetter} אות ב: בֵּאֲרוּ רַבּוֹתֵינוּ בַּעֲלֵי הַתּוֹסָפוֹת דְּכָל מִצְוָה הַתְּלוּיָה בַּיּוֹם נוֹהֶגֶת מֵעֲלוֹת הַשַּׁחַר.`
            : `תוספות לסוגיא ${sugyaLetter} אות ב: וְאַף עַל גַּב דְּבְקָדָשִׁים הַלַּיְלָה הוֹלֵךְ אַחַר הַיּוֹם שֶׁעָבַר דִּכְתִיב בְּיוֹם קָרְבָּנוֹ יֵאָכֵל לֹא יַנִּיחַ מִמֶּנּוּ עַד בֹּקֶר, מִכָּל מָקוֹם בְּמַעֲשֵׂה בְּרֵאשִׁית וּבְשַׁבָּתוֹת וּמוֹעֲדִים הַלַּיְלָה קוֹדֵם לַיּוֹם וְעַל כֵּן הִקְדִּים הַכָּתוּב בְּשָׁכְבְּךָ לִפְנֵי וּבְקוּמֶךָ.`;
        const tos2Raw = `${seed.longDibbur2}: ${tos2Body}`;
        units.push({
          id: tos2Id,
          role: 'secondary_comment',
          rawText: tos2Raw,
          styleName: 'Tosafot-Square',
          order: ++order,
          hierarchyLevel: 3,
          parentId: chId,
          dibburHamatchil: seed.longDibbur2,
          linkedSourceId: srcId,
        });
        links.push({
          linkId: `link-${tos2Id}-${srcId}`,
          sourceUnitId: srcId,
          commentaryUnitId: tos2Id,
          dibburHamatchil: seed.longDibbur2,
          isUserLocked: true,
          confidenceScore: 0.99,
          sourceSnippet: rawSourceText.substring(0, 60),
          commentarySnippet: tos2Raw.substring(0, 60),
          commentaryType: 'Tosafot',
        });
        longDibburCount++;
        syntheticTestUnitIds.push(tos2Id);

        // Emit the anchored Footnote unit if this sugya has one
        if (currentFnNum && currentFnId) {
          let fnRawText: string;
          if (isLongMultiPageFootnote) {
            // Very long scholarly footnote (~145 words) designed to exceed a single page's footnote zone cap
            // (`maxRavFnLinesPerPage`) and continue cleanly onto the following page!
            fnRawText = `${currentFnNum}. הערת עומק מורחבת לסוגיא ${sugyaLetter}: עַיֵּן בְּפֵרוּשׁ הַמִּשְׁנָיוֹת לְהָרַמְבַּ״ם וּבְהִלְכוֹת קְרִיאַת שְׁמַע פֶּרֶק רִאשׁוֹן הֲלָכָה א׳–ט׳ שֶׁפָּסַק כְּדִבְרֵי חֲכָמִים שֶׁסּוֹף זְמַן קְרִיאַת שְׁמַע שֶׁל לַיְלָה מִדִּבְרֵי סוֹפְרִים הוּא עַד חֲצוֹת הַלַּיְלָה וּמִן הַתּוֹרָה עַד שֶׁיַּעֲלֶה עַמּוּד הַשָּׁחַר. וּבְחִדּוּשֵׁי הָרַשְׁבָּ״א וְהָרִיטְבָּ״א הֶאֱרִיכוּ לְבָאֵר אֶת שִׁיטַת רַבִּי אֱלִיעֶזֶר וְרַבָּן גַּמְלִיאֵל, וְהֵבִיאוּ רְאָיוֹת מִן הַתַּלְמוּד הַיְּרוּשַׁלְמִי בְּרֵישׁ מַסֶּכֶת בְּרָכוֹת עַל שִׁעוּר הִילּוּךְ מִיל וְעַל הַהֶבְדֵּל שֶׁבֵּין כּוֹכָבִים גְּדוֹלִים הַנִּרְאִים מִבְּעוֹד יוֹם לְבֵין כּוֹכָבִים בֵּינוֹנִיִּים וּקְטַנִּים הַנִּרְאִים רַק לְאַחַר שְׁקִיעַת הַחַמָּה. וְעוֹד הוֹסִיפוּ בְּסֵפֶר שְׁאֵלוֹת וּתְשׁוּבוֹת הַגְּאוֹנִים לְברר אֶת מִנְהַג בָּתֵּי הַכְּנֵסִיּוֹת בְּבָבֶל וּבְאֶרֶץ יִשְׂרָאֵל בִּקְרִיאַת שְׁמַע שֶׁעַל הַמִּטָּה וּבִקְרִיאַת שְׁמַע שֶׁל תְּפִלַּת עַרְבִית בְּצִבּוּר, שֶׁכָּל אֵלּוּ הַדְּבָרִים מְאִירִים אֶת עֵינֵי הַלּוֹמְדִים בְּהֲבָנַת עֹמֶק הַסּוּגְיָא מֵרֵישָׁא וְעַד סֵיפָא.`;
            longFootnoteIds.push(currentFnId);
          } else if (currentFnNum % 2 === 0) {
            // Medium footnote (~35 words)
            fnRawText = `${currentFnNum}. הערה לסוגיא ${sugyaLetter}: השווה לדברי התוספות במסכת פסחים דף ב עמוד א ובמסכת מגילה דף כ עמוד א בעניין חישוב שעות זמניות וצאת הכוכבים לשיטת רבנו תם והגאונים.`;
          } else {
            // Short footnote (~16 words)
            fnRawText = `${currentFnNum}. מקור לסוגיא ${sugyaLetter}: ויקרא פרק כב פסוק ז, דברים פרק ו פסוק ז.`;
          }

          units.push({
            id: currentFnId,
            role: 'footnote',
            rawText: fnRawText,
            styleName: 'Footnote Text',
            order: ++order,
            hierarchyLevel: 4,
            parentId: srcId,
            footnoteAnchorUnitId: srcId,
            footnoteNumber: currentFnNum,
          });
          syntheticTestUnitIds.push(currentFnId);
        }
      }
    }

    return {
      title: 'מסכת ברכות — מהדורת מבחן מאמץ רב-עמודית',
      units,
      links,
      metadata: {
        chapterCount: chapterTitles.length,
        sourceUnitCount: units.filter(u => u.role === 'main_source').length,
        rashiUnitCount: units.filter(u => u.role === 'primary_comment').length,
        tosafotUnitCount: units.filter(u => u.role === 'secondary_comment').length,
        footnoteUnitCount: units.filter(u => u.role === 'footnote').length,
        headingUnitCount: units.filter(u => u.role === 'chapter' || u.role === 'heading').length,
        authenticUnitIds,
        syntheticTestUnitIds,
        shortDibburCount,
        longDibburCount,
        multiCommentarySourceCount,
        longFootnoteIds,
      },
    };
  }

  /**
   * Executes the complete Stage 13A-4 Large-Document Stress Test:
   * 1. Paginates the 35–48 page Hebrew Sefer fixture under the current authoritative design settings.
   * 2. Exports the entire multi-page document to native searchable vector PDF (`PdfExporter.generateMultiPagePdf`).
   * 3. Extracts all text, coordinates, and vector operations from the PDF binary (`PdfExporter.extractPdfContent`).
   * 4. Audits word-for-word conservation, link integrity, 2D collisions, clipping, RTL order, combining marks,
   *    footnote overlap, page utilization, sparse-page classification, and native PDF search/extraction.
   */
  public static async runLargeDocumentStressTest(): Promise<LargeDocumentStressReport> {
    const fixture = this.buildLargeSeferFixture();
    const designSettings = DesignSettingsEngine.createDefaultSettings();

    const bookDoc: BookTypesetDocument = PaginationEngine.paginateDocument({
      title: fixture.title,
      layoutType: 'rav_text',
      units: fixture.units,
      links: fixture.links,
      geometry: DEFAULT_STRESS_GEOMETRY,
      designSettings,
    });

    const failures: string[] = [];

    // 1. Word-for-word conservation check across Source, Rashi, Tosafot, and Footnotes
    const countWordsInUnits = (roleFilter: (u: ContentUnit) => boolean): string[] => {
      const words: string[] = [];
      for (const u of fixture.units.filter(roleFilter)) {
        if (u.textRuns && u.textRuns.length > 0) {
          for (const r of u.textRuns) {
            const tokens = r.text.trim().split(/\s+/).filter(Boolean);
            words.push(...tokens);
          }
        } else {
          const tokens = u.rawText.trim().split(/\s+/).filter(Boolean);
          words.push(...tokens);
        }
      }
      return words;
    };

    const expectedSourceWords = countWordsInUnits(
      u => u.role === 'main_source' || u.role === 'chapter' || u.role === 'heading'
    );
    const expectedRashiWords = countWordsInUnits(u => u.role === 'primary_comment');
    const expectedTosafotWords = countWordsInUnits(u => u.role === 'secondary_comment');
    const expectedFootnoteWords = countWordsInUnits(u => u.role === 'footnote');

    const placedSourceWords = bookDoc.pages.flatMap(p =>
      p.sourceLines.flatMap(l => l.words.filter(w => !w.isSpace).map(w => w.text))
    );
    const placedRashiWords = bookDoc.pages.flatMap(p =>
      p.rashiLines.flatMap(l => l.words.filter(w => !w.isSpace).map(w => w.text))
    );
    const placedTosafotWords = bookDoc.pages.flatMap(p =>
      p.tosafotLines.flatMap(l => l.words.filter(w => !w.isSpace).map(w => w.text))
    );
    const placedFootnoteWords = bookDoc.pages.flatMap(p =>
      (p.footnoteLines ?? []).flatMap(l => l.words.filter(w => !w.isSpace).map(w => w.text))
    );

    const compareWordStreams = (expected: string[], placed: string[]) => {
      const sameLength = expected.length === placed.length;
      let reordered = 0;
      const minLen = Math.min(expected.length, placed.length);
      for (let i = 0; i < minLen; i++) {
        if (expected[i] !== placed[i]) reordered++;
      }
      const missing = Math.max(0, expected.length - placed.length);
      const duplicated = Math.max(0, placed.length - expected.length);
      return {
        exactMatch: sameLength && reordered === 0,
        missing,
        duplicated,
        reordered,
      };
    };

    const srcCmp = compareWordStreams(expectedSourceWords, placedSourceWords);
    const rashiCmp = compareWordStreams(expectedRashiWords, placedRashiWords);
    const tosCmp = compareWordStreams(expectedTosafotWords, placedTosafotWords);
    const fnCmp = compareWordStreams(expectedFootnoteWords, placedFootnoteWords);

    if (!srcCmp.exactMatch) {
      failures.push(
        `Source word conservation mismatch: expected ${expectedSourceWords.length}, placed ${placedSourceWords.length} (reordered=${srcCmp.reordered})`
      );
    }
    if (!rashiCmp.exactMatch) {
      failures.push(
        `Rashi word conservation mismatch: expected ${expectedRashiWords.length}, placed ${placedRashiWords.length} (reordered=${rashiCmp.reordered})`
      );
    }
    if (!tosCmp.exactMatch) {
      failures.push(
        `Tosafot word conservation mismatch: expected ${expectedTosafotWords.length}, placed ${placedTosafotWords.length} (reordered=${tosCmp.reordered})`
      );
    }
    if (!fnCmp.exactMatch) {
      failures.push(
        `Footnote word conservation mismatch: expected ${expectedFootnoteWords.length}, placed ${placedFootnoteWords.length} (reordered=${fnCmp.reordered})`
      );
    }

    // 2. Link integrity verification
    const definedLinkIds = new Set(fixture.links.map(l => l.linkId));
    const activeLinkIdsAcrossPages = new Set<string>();
    let samePageLinksCount = 0;
    let crossPageContinuationLinksCount = 0;

    // Map each unitId -> set of page indices where it appears
    const unitPagesMap = new Map<string, Set<number>>();
    for (let pIdx = 0; pIdx < bookDoc.pages.length; pIdx++) {
      const pg = bookDoc.pages[pIdx];
      for (const ln of [...pg.sourceLines, ...pg.rashiLines, ...pg.tosafotLines]) {
        if (ln.unitId) {
          if (!unitPagesMap.has(ln.unitId)) unitPagesMap.set(ln.unitId, new Set());
          unitPagesMap.get(ln.unitId)!.add(pIdx);
        }
        for (const w of ln.words) {
          if (w.unitId) {
            if (!unitPagesMap.has(w.unitId)) unitPagesMap.set(w.unitId, new Set());
            unitPagesMap.get(w.unitId)!.add(pIdx);
          }
        }
      }
      for (const al of pg.activeLinks ?? []) {
        activeLinkIdsAcrossPages.add(al.linkId);
      }
    }

    let brokenLinksCount = 0;
    for (const lnk of fixture.links) {
      const srcPages = unitPagesMap.get(lnk.sourceUnitId);
      const cmtPages = unitPagesMap.get(lnk.commentaryUnitId);
      if (!srcPages || srcPages.size === 0 || !cmtPages || cmtPages.size === 0) {
        brokenLinksCount++;
        continue;
      }
      const sharesSamePage = Array.from(srcPages).some(p => cmtPages.has(p));
      if (sharesSamePage) {
        samePageLinksCount++;
      } else {
        const minSrcP = Math.min(...Array.from(srcPages));
        const maxCmtP = Math.max(...Array.from(cmtPages));
        if (maxCmtP >= minSrcP) {
          crossPageContinuationLinksCount++;
        } else {
          brokenLinksCount++;
        }
      }
    }

    if (brokenLinksCount > 0) {
      failures.push(`Found ${brokenLinksCount} broken source-commentary links.`);
    }

    // 3. Per-page collision, clipping, RTL order, combining mark, footnote overlap, and utilization audit
    const contentWidth =
      DEFAULT_STRESS_GEOMETRY.pageWidth -
      DEFAULT_STRESS_GEOMETRY.marginInside -
      DEFAULT_STRESS_GEOMETRY.marginOutside;
    const contentHeight =
      DEFAULT_STRESS_GEOMETRY.pageHeight -
      DEFAULT_STRESS_GEOMETRY.marginTop -
      DEFAULT_STRESS_GEOMETRY.marginBottom;

    let totalCollisions = 0;
    let totalClippingIssues = 0;
    let totalRtlViolations = 0;
    let totalOrphanMarks = 0;
    let totalFootnoteOverlaps = 0;

    const pageMetrics: PageStressMetrics[] = [];

    for (let pIdx = 0; pIdx < bookDoc.pages.length; pIdx++) {
      const page = bookDoc.pages[pIdx];
      const nextPage = pIdx + 1 < bookDoc.pages.length ? bookDoc.pages[pIdx + 1] : undefined;
      const renderPlan = PdfExporter.buildPageRenderPlan(page);

      // Audit 2D spatial collisions
      const collisions = SpatialExclusionEngine.auditPageCollisions(
        page.sourceLines,
        page.rashiLines,
        page.tosafotLines,
        page.footnoteLines ?? [],
        page.column2Lines ?? [],
        contentWidth
      );
      const pageCollisions = collisions.length;
      totalCollisions += pageCollisions;

      // Audit clipping (text exceeding page boundaries or content bounds)
      let pageClipping = 0;
      const allPageLines = [
        ...page.sourceLines,
        ...page.rashiLines,
        ...page.tosafotLines,
        ...(page.footnoteLines ?? []),
      ];
      for (const ln of allPageLines) {
        const yBtm = ln.yBottom ?? ln.yBaseline + ln.descent;
        if (yBtm > contentHeight + 12 || (ln.yTop ?? ln.yBaseline - ln.ascent) < -6) {
          pageClipping++;
        }
        if ((ln.xLeft ?? 0) < -4 || (ln.xRight ?? contentWidth) > contentWidth + 4) {
          pageClipping++;
        }
      }
      totalClippingIssues += pageClipping;

      // Audit RTL monotonic word order on every line in the authoritative renderPlan
      let pageRtlViolations = 0;
      for (const lCmd of renderPlan.lines) {
        for (let wIdx = 0; wIdx + 1 < lCmd.words.length; wIdx++) {
          const currW = lCmd.words[wIdx];
          const nextW = lCmd.words[wIdx + 1];
          if (currW.xRight < nextW.xRight - 0.5) {
            pageRtlViolations++;
          }
        }
      }
      totalRtlViolations += pageRtlViolations;

      // Audit orphan combining marks
      let pageOrphanMarks = 0;
      for (const ln of allPageLines) {
        for (const w of ln.words) {
          if (w.glyphs.length > 0 && w.glyphs[0].isMark) {
            pageOrphanMarks++;
          }
        }
      }
      totalOrphanMarks += pageOrphanMarks;

      // Audit footnote overlap with main/commentary body
      let pageFnOverlap = 0;
      if (page.footnoteLines && page.footnoteLines.length > 0) {
        const fnTopY = Math.min(
          ...page.footnoteLines.map(fl => fl.yTop ?? fl.yBaseline - fl.ascent)
        );
        const bodyLines = [...page.sourceLines, ...page.rashiLines, ...page.tosafotLines];
        if (bodyLines.length > 0) {
          const bodyMaxBottomY = Math.max(
            ...bodyLines.map(bl => bl.yBottom ?? bl.yBaseline + bl.descent)
          );
          if (bodyMaxBottomY > fnTopY + 1.0) {
            pageFnOverlap++;
          }
        }
      }
      totalFootnoteOverlaps += pageFnOverlap;

      // Calculate geometric area & vertical span utilization
      let occupiedAreaPt2 = 0;
      let maxLineBottomY = 0;
      for (const ln of allPageLines) {
        const w = Math.max(ln.width, (ln.xRight ?? ln.targetWidth) - (ln.xLeft ?? 0));
        occupiedAreaPt2 += w * ln.height;
        maxLineBottomY = Math.max(maxLineBottomY, ln.yBottom ?? ln.yBaseline + ln.descent);
      }
      const occupiedAreaRatioPercent = Math.min(
        100,
        Math.round((occupiedAreaPt2 / (contentWidth * contentHeight)) * 100)
      );
      const verticalSpanRatioPercent = Math.min(
        100,
        Math.round((maxLineBottomY / contentHeight) * 100)
      );
      const utilizationPercent = page.layoutScore?.pageUtilization ?? verticalSpanRatioPercent;

      const hasChapterHeading = page.sourceLines.some(l => l.role === 'chapter');
      const isDocumentEndingPage = pIdx === bookDoc.pages.length - 1;
      const isBeforeChapterOpening = Boolean(
        nextPage && nextPage.sourceLines.some(l => l.role === 'chapter')
      );

      const totalLinesOnPage = allPageLines.length;
      const isSparse = utilizationPercent < 45 || totalLinesOnPage <= 6;

      let sparseClassification: PageStressMetrics['sparseClassification'] = 'normal';
      if (isSparse) {
        if (isDocumentEndingPage) {
          sparseClassification = 'legitimate_document_ending';
        } else if (isBeforeChapterOpening) {
          sparseClassification = 'legitimate_chapter_transition';
        } else {
          sparseClassification = 'suspicious_sparse_defect';
        }
      }

      pageMetrics.push({
        pageNumber: page.pageNumber,
        pageNumberHebrew: page.pageNumberHebrew,
        sourceLineCount: page.sourceLines.length,
        rashiLineCount: page.rashiLines.length,
        tosafotLineCount: page.tosafotLines.length,
        footnoteLineCount: (page.footnoteLines ?? []).length,
        totalLineCount: totalLinesOnPage,
        sourceWordCount: page.sourceLines.reduce(
          (acc, l) => acc + l.words.filter(w => !w.isSpace).length,
          0
        ),
        rashiWordCount: page.rashiLines.reduce(
          (acc, l) => acc + l.words.filter(w => !w.isSpace).length,
          0
        ),
        tosafotWordCount: page.tosafotLines.reduce(
          (acc, l) => acc + l.words.filter(w => !w.isSpace).length,
          0
        ),
        footnoteWordCount: (page.footnoteLines ?? []).reduce(
          (acc, l) => acc + l.words.filter(w => !w.isSpace).length,
          0
        ),
        utilizationPercent,
        occupiedAreaRatioPercent,
        verticalSpanRatioPercent,
        collisionCount: pageCollisions,
        clippingCount: pageClipping,
        rtlViolationCount: pageRtlViolations,
        orphanMarkCount: pageOrphanMarks,
        footnoteOverlapCount: pageFnOverlap,
        hasChapterHeading,
        isDocumentEndingPage,
        isBeforeChapterOpening,
        sparseClassification,
      });
    }

    const hardRulesReport = EngineHardRulesEngine.evaluateContext({
      bookDoc,
      units: fixture.units,
      links: fixture.links,
    });
    const qaReport = QaEngine.runBookPreflight(bookDoc);

    if (totalCollisions > 0) failures.push(`Detected ${totalCollisions} collisions across pages.`);
    if (totalClippingIssues > 0)
      failures.push(`Detected ${totalClippingIssues} clipping issues across pages.`);
    if (totalRtlViolations > 0)
      failures.push(`Detected ${totalRtlViolations} RTL ordering violations.`);
    if (totalOrphanMarks > 0)
      failures.push(`Detected ${totalOrphanMarks} orphan combining marks.`);
    if (totalFootnoteOverlaps > 0)
      failures.push(`Detected ${totalFootnoteOverlaps} footnote overlaps.`);
    if (!hardRulesReport.passed)
      failures.push(
        `EngineHardRulesEngine failed with ${hardRulesReport.violations.length} violations.`
      );

    // 4. Utilization statistics
    const utils = pageMetrics.map(m => m.utilizationPercent);
    const sortedUtils = [...utils].sort((a, b) => a - b);
    const meanUtilizationPercent =
      utils.length > 0 ? Math.round(utils.reduce((a, b) => a + b, 0) / utils.length) : 0;
    const medianUtilizationPercent =
      sortedUtils.length > 0 ? sortedUtils[Math.floor(sortedUtils.length / 2)] : 0;
    const minUtilizationPercent = sortedUtils.length > 0 ? sortedUtils[0] : 0;
    const maxUtilizationPercent =
      sortedUtils.length > 0 ? sortedUtils[sortedUtils.length - 1] : 0;
    const variance =
      utils.length > 0
        ? utils.reduce((acc, v) => acc + Math.pow(v - meanUtilizationPercent, 2), 0) /
          utils.length
        : 0;
    const stdDevUtilizationPercent = Math.round(Math.sqrt(variance) * 10) / 10;
    const meanVerticalSpanPercent =
      pageMetrics.length > 0
        ? Math.round(
            pageMetrics.reduce((acc, m) => acc + m.verticalSpanRatioPercent, 0) /
              pageMetrics.length
          )
        : 0;

    const suspiciousPages = pageMetrics.filter(
      m => m.sparseClassification === 'suspicious_sparse_defect'
    );
    const legitimateSparsePages = pageMetrics.filter(
      m =>
        m.sparseClassification === 'legitimate_document_ending' ||
        m.sparseClassification === 'legitimate_chapter_transition'
    );
    const normalPages = pageMetrics.filter(m => m.sparseClassification === 'normal');

    // 5. Export full document to native searchable PDF and verify extraction & search
    const pdfBlob = await PdfExporter.generateMultiPagePdf(bookDoc);
    const extractedPdf = await PdfExporter.extractPdfContent(pdfBlob);

    const noFullPageRasterImages = extractedPdf.pages.every(p => !p.hasFullPageRasterImage);
    const extractedTotalSpanCount = extractedPdf.pages.reduce(
      (acc, p) => acc + p.spans.length,
      0
    );

    const mTop = DEFAULT_STRESS_GEOMETRY.marginTop;
    const mBottom = DEFAULT_STRESS_GEOMETRY.pageHeight - DEFAULT_STRESS_GEOMETRY.marginBottom;
    const extractedBodyWordCount = extractedPdf.pages.reduce(
      (acc, pg) =>
        acc +
        pg.lines
          .filter(l => l.yBaselinePt >= mTop && l.yBaselinePt <= mBottom)
          .reduce(
            (sAcc, l) =>
              sAcc + l.spans.filter(s => !/^\[\d+\]$/.test(s.text)).length,
            0
          ),
      0
    );

    const boldDibburSpanCount = extractedPdf.pages.reduce(
      (acc, pg) => acc + pg.spans.filter(s => s.isBoldFont).length,
      0
    );

    // Search queries across chapters, sugyot, Niqqud, Taamim, Rashi, Tosafot, and long Footnotes
    const searchQueriesWithNiqqud = [
      'מֵאֵימָתַי',
      'בְּתְרוּמָתָן',
      'וְשִׁנַּנְתָּ֣ם',
      'בְּרֵאשִׁ֖ית',
      'פְּתִ֥יל',
      'כִּכְתָבָהּ',
      'הָרַמְבַּ״ם',
      'הָרַשְׁבָּ״א',
      'פֶּרֶק חֲמִישִׁי',
    ];
    const searchQueriesStripped = [
      'מאימתי',
      'בתרומתן',
      'ושננתם',
      'בראשית',
      'פתיל',
      'ככתבה',
      'הרמב״ם',
      'הרשב״א',
      'פרק חמישי',
      'לסוגיא א',
      'לסוגיא י',
      'לסוגיא כ',
      'הערת עומק מורחבת',
    ];

    const niqqudQueriesPassed = ['מֵאֵימָתַי', 'כִּכְתָבָהּ', 'הָרַמְבַּ״ם', 'פֶּרֶק חֲמִישִׁי'].every(
      q => extractedPdf.fullText.includes(q)
    );
    const taamimQueriesPassed = ['וְשִׁנַּנְתָּ֣ם', 'בְּרֵאשִׁ֖ית', 'פְּתִ֥יל'].every(q =>
      extractedPdf.fullText.includes(q)
    );
    const strippedQueriesPassedCount = searchQueriesStripped.filter(q =>
      extractedPdf.strippedFullText.includes(PdfNativeTextEngine.stripNikud(q))
    ).length;

    const totalQueries = 4 + 3 + searchQueriesStripped.length;
    const succeededQueries =
      ['מֵאֵימָתַי', 'כִּכְתָבָהּ', 'הָרַמְבַּ״ם', 'פֶּרֶק חֲמִישִׁי'].filter(q =>
        extractedPdf.fullText.includes(q)
      ).length +
      ['וְשִׁנַּנְתָּ֣ם', 'בְּרֵאשִׁ֖ית', 'פְּתִ֥יל'].filter(q =>
        extractedPdf.fullText.includes(q)
      ).length +
      strippedQueriesPassedCount;

    // Verify 1:1 coordinate fidelity on sampled pages (first, middle, last)
    const samplePageIndices = [
      0,
      Math.floor(bookDoc.pages.length / 2),
      bookDoc.pages.length - 1,
    ];
    let coordinateSampleMatchedCount = 0;
    let coordinateSampleTotalCount = 0;

    for (const spIdx of samplePageIndices) {
      const pg = bookDoc.pages[spIdx];
      const extPg = extractedPdf.pages[spIdx];
      if (!pg || !extPg) continue;
      const plan = PdfExporter.buildPageRenderPlan(pg);
      for (const lCmd of plan.lines) {
        for (const wCmd of lCmd.words) {
          coordinateSampleTotalCount++;
          const matched = extPg.spans.some(
            s =>
              s.text === wCmd.text &&
              Math.abs(s.yBaselinePt - wCmd.yBaseline) <= 0.6 &&
              Math.abs(s.xRightPt - wCmd.xRight) <= 1.6
          );
          if (matched) coordinateSampleMatchedCount++;
        }
      }
    }

    const totalPlannedBodyWords =
      placedSourceWords.length +
      placedRashiWords.length +
      placedTosafotWords.length +
      placedFootnoteWords.length;

    if (extractedPdf.pageCount !== bookDoc.pages.length) {
      failures.push(
        `PDF page count (${extractedPdf.pageCount}) does not match typeset page count (${bookDoc.pages.length}).`
      );
    }
    if (!noFullPageRasterImages) {
      failures.push('One or more PDF pages contained a full-page raster image.');
    }
    if (extractedBodyWordCount !== totalPlannedBodyWords) {
      failures.push(
        `Extracted PDF body word count (${extractedBodyWordCount}) != planned body word count (${totalPlannedBodyWords}).`
      );
    }
    if (succeededQueries !== totalQueries) {
      failures.push(`Only ${succeededQueries}/${totalQueries} PDF search queries succeeded.`);
    }
    if (coordinateSampleMatchedCount !== coordinateSampleTotalCount) {
      failures.push(
        `PDF coordinate verification matched ${coordinateSampleMatchedCount}/${coordinateSampleTotalCount} words on sampled pages.`
      );
    }

    const totalExpected =
      expectedSourceWords.length +
      expectedRashiWords.length +
      expectedTosafotWords.length +
      expectedFootnoteWords.length;

    return {
      documentTitle: fixture.title,
      pageCount: bookDoc.pages.length,
      totalExpectedWords: {
        source: expectedSourceWords.length,
        rashi: expectedRashiWords.length,
        tosafot: expectedTosafotWords.length,
        footnotes: expectedFootnoteWords.length,
        total: totalExpected,
      },
      totalPlacedWords: {
        source: placedSourceWords.length,
        rashi: placedRashiWords.length,
        tosafot: placedTosafotWords.length,
        footnotes: placedFootnoteWords.length,
        total: totalPlannedBodyWords,
      },
      conservation: {
        sourceConserved100Percent: srcCmp.exactMatch,
        rashiConserved100Percent: rashiCmp.exactMatch,
        tosafotConserved100Percent: tosCmp.exactMatch,
        footnotesConserved100Percent: fnCmp.exactMatch,
        exactWordSequencePreserved:
          srcCmp.exactMatch && rashiCmp.exactMatch && tosCmp.exactMatch && fnCmp.exactMatch,
        missingWordsCount:
          srcCmp.missing + rashiCmp.missing + tosCmp.missing + fnCmp.missing,
        duplicatedWordsCount:
          srcCmp.duplicated + rashiCmp.duplicated + tosCmp.duplicated + fnCmp.duplicated,
        reorderedWordsCount:
          srcCmp.reordered + rashiCmp.reordered + tosCmp.reordered + fnCmp.reordered,
      },
      links: {
        totalDefinedLinks: definedLinkIds.size,
        activeLinksAcrossPages: activeLinkIdsAcrossPages.size,
        samePageLinksCount,
        crossPageContinuationLinksCount,
        brokenLinksCount,
        allLinksIntact: brokenLinksCount === 0 && activeLinkIdsAcrossPages.size === definedLinkIds.size,
      },
      geometryAndSafety: {
        totalCollisions,
        totalClippingIssues,
        totalRtlViolations,
        totalOrphanMarks,
        totalFootnoteOverlaps,
        engineHardRulesPassed: hardRulesReport.passed,
        qaPreflightPassed: qaReport.passed,
      },
      utilization: {
        meanUtilizationPercent,
        medianUtilizationPercent,
        minUtilizationPercent,
        maxUtilizationPercent,
        stdDevUtilizationPercent,
        meanVerticalSpanPercent,
        normalPagesCount: normalPages.length,
        legitimateEndingOrChapterPagesCount: legitimateSparsePages.length,
        suspiciousSparsePagesCount: suspiciousPages.length,
        suspiciousSparsePageNumbers: suspiciousPages.map(p => p.pageNumber),
      },
      pdfVerification: {
        pdfByteSize: pdfBlob.size,
        extractedPageCount: extractedPdf.pageCount,
        noFullPageRasterImages,
        extractedTotalSpanCount,
        extractedBodyWordCount,
        searchQueriesTested: totalQueries,
        searchQueriesSucceeded: succeededQueries,
        allSearchQueriesPassed: succeededQueries === totalQueries,
        niqqudQueriesPassed,
        taamimQueriesPassed,
        boldDibburSpanCount,
        coordinateSampleMatchedCount,
        coordinateSampleTotalCount,
      },
      pageMetrics,
      failures,
      allPassed: failures.length === 0 && bookDoc.pages.length >= 30,
    };
  }
}
