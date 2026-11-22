import React, { useEffect, useState } from 'react';
import { Sparkles, Send, Check, X, KeyRound, FileUp } from 'lucide-react';
import { ProfessionalDesignSettings } from '../types/design-settings';
import {
  DesignSettingsEngine,
  applyValidatedAiAction,
  READY_DESIGNS,
} from '../engine/design-settings-engine';
import { DocxImporter } from '../engine/docx-importer';
// v0.5.0 Part A — Module 1(d): the Gemini context lists the live font
// library (built-in + system + imported) so switch_font can name them.
import { getFontLibraryFamilies } from '../engine/font-library';
import { ContentUnit, RavTextLink } from '../types/typesetter';
import { useLanguage } from '../i18n/LanguageContext';
import {
  askGemini,
  describeGeminiError,
  GEMINI_ERROR_HEBREW,
  hasGeminiKey,
  parseGeminiActionResponse,
} from '../engine/gemini-service';
import { parseShasCommand } from '../engine/vilna-shas';
import { parseYiddishCommand } from '../engine/yiddish-sefarim';
import { buildRecipePromptContext, getRecipeByIdLocal, parseAutoLayoutCommand } from '../engine/auto-layout';

/** Before/after diff shown on the approval card for every AI-proposed change. */
export interface AiActionDiff {
  /** Setting or item being changed, e.g. 'גופן מקור' / 'Search & replace'. */
  settingName?: string;
  /** Old setting value (for settings changes). */
  oldValue?: string;
  /** New setting value (for settings changes). */
  newValue?: string;
  /** Affected text before the change (short excerpt, for text changes). */
  beforeText?: string;
  /** Affected text after the change (short excerpt, for text changes). */
  afterText?: string;
}

export type AiActionType =
  | 'adjust_knee'
  | 'adjust_spacing'
  | 'fix_qa'
  | 'switch_font'
  | 'update_design_settings'
  | 'add_commentator'
  | 'search_replace'
  | 'fix_marked_pages'
  | 'apply_ready_design'
  | 'balance_book'
  | 'request_export'
  | 'undo_last_change'
  // v0.7.0 Part 3 (M2) — Vilna Shas actions.
  | 'verify_dibbur'
  | 'fix_shas_flaws'
  | 'apply_vilna_defaults'
  | 'move_rashi'
  | 'expand_tosafot'
  | 'verify_folio_sequence'
  | 'check_footer_alignment'
  // v0.8.0 Part C (§7) — Michtav box toggle.
  | 'toggle_michtav'
  // v0.8.0 Part D — Yiddish sefarim actions.
  | 'apply_yiddish_defaults'
  | 'verify_yiddish_folio'
  | 'classify_yiddish_tiers'
  // v0.9.0 Part C — historical layout recipes + geometry flaw fixes.
  | 'applyHistoricalLayout'
  | 'applyRecipe'
  | 'explainRecipe'
  | 'changeLayout'
  | 'fix_geometry_flaws';

interface AiChatPanelProps {
  onClose?: () => void;
  onApplyAdjustment: (action: string, param?: any) => void;
  designSettings?: ProfessionalDesignSettings;
  onUpdateDesignSettings?: (next: ProfessionalDesignSettings, summaryHe: string) => void;
  selectedUnitId?: string | null;
  isDocked?: boolean;
  currentDocumentInfo: {
    title: string;
    layoutPreset: string;
    kneeJunction: number;
    qualityScore: number;
  };
  /** Opens the Gemini API key modal (App-level state). */
  onOpenGeminiKeyModal?: () => void;
  /** Bumped by App whenever the saved key changes, so the panel re-checks. */
  geminiKeyVersion?: number;
  /**
   * v0.3.0 — called when the user approves an `add_commentator` action after
   * picking a commentary .docx. App wires this to its existing import path
   * (the same handler DocxImportModal uses), so the new units + links go
   * through the normal content-update flow and stay undoable.
   */
  onImportCommentaryUnits?: (units: ContentUnit[], title: string, links?: RavTextLink[]) => void;
  /**
   * v0.3.0 — optional: given a find string, returns a short excerpt of the
   * document text around its first occurrence, so the search/replace diff
   * can show real context. Without it the diff shows the find/replace
   * strings themselves.
   */
  findTextExcerpt?: (find: string) => string | null;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  proposedAction?: {
    type: AiActionType;
    label: string;
    data: any;
    /** Before/after diff rendered on the approval card. */
    diff?: AiActionDiff;
  };
  status?: 'pending' | 'approved' | 'rejected';
}

const QUICK_AI_PROMPTS = [
  'הגדל את גופן המקור ל-15.5pt',
  'הגדל מרווח שורות ברש״י ל-14pt',
  'מרכז כותרות פרקים',
  'צמצם רווח בין עמודות ל-10pt',
  'תקן עמודים מסומנים',
];

/**
 * v0.4.0 — example things to ask, shown in the panel so a first-time user
 * sees what the assistant can do. Plain words, Hebrew keys translated
 * through t() (see src/i18n/strings.ts).
 */
const AI_EXAMPLE_PROMPTS = [
  'הגדל את הטקסט',
  'השתמש בעיצוב וילנא הקלאסי',
  'הוסף עמוד שער',
  'הקטן את מסגרת עמוד השער',
  'תקן את שגיאות הכתיב',
  'ייצא כ־PDF',
  'אזן את הספר',
  'הרחב את השוליים',
  'בטל את השינוי האחרון',
  // v0.9.3 Part C — example NL phrases for the new historical layouts
  // (each resolves through parseAutoLayoutCommand to the recipe id).
  'עמד כמו ש״ס עוז והדר',
  'החל תבנית משנה ברורה',
];

const EXPORT_FORMATS = ['pdf', 'docx', 'epub', 'html', 'txt', 'idml'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const GEMINI_SYSTEM_PROMPT = [
  'You are the typesetting assistant inside Keter Typesetter, a Hebrew holy-book',
  'typesetting studio (Vilna Shas multi-text, Mikraot Gedolot, dynamic knees).',
  'The user writes in Hebrew or English; always reply in the user\u2019s language.',
  'If you want to propose a concrete change, reply with ONLY this JSON object and nothing else:',
  '{"reply": "<short explanation>", "action": {"type": "<one of the types below>", "label": "<short label>", "data": {}, "diff": {"settingName": "<name>", "oldValue": "<old>", "newValue": "<new>", "beforeText": "<text before>", "afterText": "<text after>"}}}',
  'Action types and their data (use ONLY these; anything else will be rejected):',
  'Vilna Shas context (deterministic rules, no model training is involved): the book is a Vilna Shas page — central justified Gemara columns, Perek title centred at the top, folio numbers in Hebrew gematria (2a = Daf Bet Amud Rishon on the LEFT of a spread, 2b on the RIGHT — Hebrew books open left-to-right-reversed: the recto/a-side is the left-hand page), Rashi always on the INNER margin and Tosafot always on the OUTER margin following the facing page, every commentary paragraph starts with a bolded Dibbur Hamatchil linked to the matching Gemara words, second-row (hanging) indent on Gemara paragraphs, secondary commentaries (Ein Mishpat, Ner Mitzvah, Torah Or, Masoret HaShas) in the outer/bottom margins. When the user asks about Shas layout, use ONLY the Shas action types below; never invent a folio number or a dibbur link.',
  'Yiddish sefarim context (deterministic rules, no model training is involved): Yiddish books use the same Hebrew alphabet plus the Yiddish-only letters U+05F0 װ (double vav), U+05F1 ױ (vav-yod) and U+05F2 ײ (double yod), which are single codepoints and must never be split or folded; פּ (pe + dagesh) and פֿ (fe + rafe) are distinct letters whose marks are orthographic, not nikud, and must never be stripped. Structures: Tzenerene (Tzena Urena, Yiddish commentary woven around the weekly parsha, parsha headings centred), Chassidic Yiddish commentaries, Yiddish translations facing their Hebrew source (Hebrew in the RIGHT column, Yiddish in the LEFT column on the same page), and Biurim (Yiddish explanations). Yiddish text is usually unpointed; Hebrew quotes inside Yiddish text keep their nikud. When the user asks about a Yiddish book, use ONLY the Yiddish action types below.',
  '- apply_yiddish_defaults {} — centred parsha headings, justified Yiddish body, no first-line indent.',
  '- verify_yiddish_folio {} — check the Yiddish folio sequence and Hebrew folio labels.',
  '- classify_yiddish_tiers {} — re-classify the book units as Tzenerene / translation / Biur / Hebrew source.',
  '- verify_dibbur {} — check every dibbur hamatchil against the Gemara text and report pass/fail.',
  '- fix_shas_flaws {} — scan folios for Vilna flaws (widows, orphans, misaligned Rashi/Tosafot boundaries, missing folio numbers, broken dibbur links) and apply the one-click auto-fixes.',
  '- apply_vilna_defaults {} — centred Perek title, second-row indent, bold dibbur.',
  '- move_rashi {"closer": true|false} — move Rashi closer to / further from the Gemara column (gutter).',
  '- expand_tosafot {"widthPct": <20-40>} — widen the Tosafot column.',
  '- verify_folio_sequence {} — check folio pagination sequence.',
  '- check_footer_alignment {} — check alignment of footer references.',
  '- toggle_michtav {"enabled": true|false, "text": "<optional Michtav text>"} — show or hide the decorative Michtav box above the Gemara text on the first Vilna page.',
  '- adjust_spacing {"gutter": <pt, 6-36>} — gutter between source and commentaries.',
  '- adjust_knee {"kneeJunctionY": <pt>} — knee junction height on the page.',
  '- fix_qa {} — apply the auto-fixable proofreading fixes.',
  '- fix_marked_pages {} — apply fixes to QA-flagged pages.',
  '- switch_font {"role": "main_source"|"primary_comment"|"secondary_comment"|"regular_paragraph"|"chapter"|"footnote", "fontFamily": "<one of the known fonts listed in the context>"} — never invent a font name.',
  '- update_design_settings {"patch": {<see below>}} — layout, margins, sizes, spacing, headers, columns, page size. Patch fields: layoutType ("rav_text"|"single_column"|"two_column"|"source_top_commentary_bottom"|"mikraot_gedolot"|"custom_layout"|"yiddish_sefer"), pageSizePreset ("a4"|"b5"|"pocket"|"small_a5"|"regular_17x24"|"wide_17x25"|"booklet_a4"|"gemara_24x34"|"vilna_folio"|"crown_quarto"|"royal_holy_book"|"custom"), orientation ("portrait"|"landscape"), margins {top|bottom|inside|outside|all: <pt 0-144>}, columnCount (1|2|3), columnGutterPt (6-48), balanceColumns (true|false), showRunningHeader/showRunningFooter/showFolioNumber/showTopHeaderLine/showCommentaryLabels/showDafPrefix (true|false), pageNumberStyle ("numbers"|"hebrew"), dafFormat ("dots"|"amud_hebrew"|"gematria"|"numbers"), openingDecoration {enabled: true|false, styleId: "simple_frame"|"double_ornate"|"crown_panel"|"chumash_cartouche"|"patterned_rect"|"stepped_frame"|"corner_ornament", wordCount: 1-4, paddingPt: 0-24, thicknessPt: 0.4-4, scope: "masechet_start"|"chapter_start"}, commentarySeparator ("none"|"colon"|"colon_dot"|"thin_rule"|"centered_diamond"|"double_rule"|"scrolled_divider"), paragraphSeparator ("none"|"colon"|"colon_dot"|"thin_rule"|"centered_diamond"|"double_rule"|"scrolled_divider"), transitionMarker {enabled: true|false, style: "text"|"boxed", sizePt: 7-24, position: "before_first_word"|"after_last_word", markerText: "<up to 12 chars>"} (transitionMarkerEnabled (true|false) still works as a shorthand for on/off), indentMode ("none"|"first_line"|"hanging"|"chalon_second_line"|"chalon_window"|"chalon_all", with chalonIndentPt 0-72 and chalonLineCount 1-6), runningHeader {leftText|centerText|rightText: \"<text>\" (omit a slot to keep its automatic text: centre = book title, right = page number, left = edition label), showBookTitle|showChapterTitle|showPageNumber (true|false, each header element independently), alignment (\"left\"|\"center\"|\"right\"), fontFamily: \"<font>\", fontSizePt (8-24)}, customLayoutBox {id, role, xPct, yPct, widthPct, heightPct, shape: {kind: "rectangle"|"l_shape"|"t_shape"|"inverted_t"|"cross"|"custom", points: [[x,y]...] (0..1 in the box)}, exclusions: [{id, points: [[x,y]...]}]} — add or reshape one custom-layout box (a shape makes the text flow around the polygon), customLayoutPageOverride {pageIndex: <0-based body page>, boxes: [<same box objects>]} — replace the layout of ONE page only, clearCustomLayoutPageOverride <0-based body page> — that page goes back to the global template, titlePage {enabled: true|false, title|subtitle|author|translator|publisher|volume|year: "<text>", extraLines: ["<text>"], borderStyleId: "none"|"single"|"double"|"corner"|"stepped"|"patterned"|"ornate"|"chamfer_knot"|"dark_mosaic"|"floral_panel"|"bevel_molded"|"rosette_band"|"palmette_frieze", borderThicknessPt: 0.5-4, borderInsetMm: 0-25, borderEnabled: true|false, borderScalePct: 50-150, borderPaddingMm: 0-25, borderOffsetXMm: -25-25, borderOffsetYMm: -25-25, fieldLineHeight: {title|subtitle|author: <1.0-2.0>}} — the title page is the book’s first page (off by default); setting a title or a border also turns it on.',
  '- apply_ready_design {"presetId": "<one of the ready-design ids listed in the context>"} — never invent a preset id.',
  '- applyHistoricalLayout {"recipeId": "<one of: vilna-shas, mikraot-gedolot, shulchan-aruch, responsa, chassidic-drush, yiddish-sefer, tzenerene, machon-edition, shas-oz-vehadar, shas-artscroll, shas-steinzaltz, yerushalmi, mishnah-classic, mishnah-kehati, mishneh-torah, mishnah-berurah, aruch-hashulchan, tur, kitzur-shulchan-aruch, chumash, tanach-commentary, midrash, ein-yaakov, mussar, tanya, machzor, single-column, two-column>"} — lay the document out with that historical recipe.',
  '- applyRecipe {"recipeId": "<id>"} or {"templateId": "<loaded .keter-template id>"} — apply a recipe or a loaded template; a templateId that is not loaded must be refused, never guessed.',
  '- explainRecipe {"recipeId": "<id>"} — explain the recipe and its rules; omit recipeId to explain the current layout.',
  '- changeLayout {} — open the layout picker so the user can choose another layout.',
  '- fix_geometry_flaws {} — apply the corrective geometry shifts from the flaw scan (gutter widening, knee-junction shift).',
  '- add_commentator {} — the user picks the commentary file (their own .docx) in the approval card; never fetch text from any online library.',
  '- search_replace {"find": "<text>", "replace": "<text>"} and diff.beforeText/afterText with short excerpts of the affected text.',
  '- balance_book {} — re-run whole-book balancing.',
  '- request_export {"format": "pdf"|"docx"|"epub"|"html"|"txt"|"idml", "includeCover": true|false, "includeToc": true|false} — this only opens the export step; the user confirms the format and download there. Never claim a file was written.',
  '- undo_last_change {} — undo the last applied change.',
  // v0.9.0 Part C — historical layout recipes: summaries + rules, so the
  // assistant can read a loaded .keter-template, explain it, and apply
  // its rules (only the validated recipe action types above).
  buildRecipePromptContext(),
  'Always include a diff when the change alters a setting or text: settingName with oldValue -> newValue, and beforeText/afterText for text changes. Use the current values from the context as oldValue.',
  'If no concrete change is warranted, reply with ONLY {"reply": "<your answer>"}.',
  'Never claim a change was applied: the user approves every change first.',
].join('\n');

/**
 * v0.3.0 — parses "החלף X ב-Y" / "replace X with Y" (quotes optional).
 * Returns null when the text is not a search/replace command.
 */
function parseSearchReplaceCommand(userText: string): { find: string; replace: string } | null {
  const m = userText.match(
    /(?:החלף|replace)\s+["'«“]?(.+?)["'»”]?\s+(?:ב[־\-]?|with)\s*["'«“]?(.+?)["'»”]?\s*$/
  );
  if (!m) return null;
  const find = (m[1] || '').trim();
  const replace = (m[2] || '').trim();
  if (!find || !replace || find === replace) return null;
  return { find, replace };
}

/**
 * v0.4.0 — panel-level intents the design-settings engine does not own:
 * export (PDF/Word/EPUB/HTML/text/IDML, cover page, table of contents),
 * whole-book balancing, undo, and proofreading. Pure function (no React),
 * so the parser test can call it directly.
 *
 * Verified against the real code before wiring (2026-11-08):
 * - Export formats Word/EPUB/HTML/text run inside ExportWorkspaceView;
 *   PDF/IDML run through App's handlers. There is NO direct "write a file"
 *   call from the chat panel, so `request_export` only opens the export
 *   step — the user picks the format and confirms the download there.
 * - Cover page and table of contents are PDF export options
 *   (includeCover / includeToc in the export step), not pages in the book.
 * - Whole-book balancing is the guarded post-pass over paginated pages;
 *   App re-runs it when `balance_book` is approved.
 * - Proofreading fixes are the auto-fixable text issues App already
 *   applies for `fix_marked_pages`.
 * - Adding / removing / moving / splitting PAGES has no capability in the
 *   app (pages are derived from the book's text by pagination), so those
 *   requests get a plain honest reply, never a fake action card.
 */
export interface PanelIntentContext {
  qualityScore: number;
  findTextExcerpt?: (find: string) => string | null;
}

export type PanelIntentResult =
  | {
      kind: 'action';
      replyHe: string;
      /** English reply for composed replies (see AutoLayoutCommand.replyEn). */
      replyEn?: string;
      /** Language-neutral suffix appended after the translated reply (e.g. "PDF"). */
      replySuffix?: string;
      action: {
        type: AiActionType;
        label: string;
        data: Record<string, unknown>;
        diff?: AiActionDiff;
      };
    }
  | { kind: 'plain'; replyHe: string; replyEn?: string };

export function parsePanelIntentCommand(
  userText: string,
  ctx: PanelIntentContext
): PanelIntentResult | null {
  const lower = userText.toLowerCase();
  const norm = lower.replace(/[־–—-]/g, ' ');

  // v0.7.0 Part 3 (M2) — Vilna Shas natural-language layout commands
  // ("move Rashi closer to the Gemara column", "expand Tosafot width",
  // "check alignment of footer references", "verify folio pagination
  // sequence"). Local, deterministic parsing — no model call.
  const shasCmd = parseShasCommand(userText);
  if (shasCmd) {
    return {
      kind: 'action',
      replyHe: shasCmd.replyHe,
      action: {
        type: shasCmd.action,
        label: 'Vilna Shas',
        data: shasCmd.data,
        diff: { settingName: 'ש״ס וילנא', oldValue: '', newValue: '' },
      },
    };
  }

  // v0.8.0 Part D — Yiddish natural-language layout commands
  // ("החל כללי יידיש", "בדוק רצף דפים יידיש", "סווג טקסט יידיש").
  // Local, deterministic parsing — no model call.
  const yiddishCmd = parseYiddishCommand(userText);
  if (yiddishCmd) {
    return {
      kind: 'action',
      replyHe: yiddishCmd.replyHe,
      action: {
        type: yiddishCmd.action,
        label: 'ספר יידיש',
        data: yiddishCmd.data,
        diff: { settingName: 'ספר יידיש', oldValue: '', newValue: '' },
      },
    };
  }

  // v0.9.0 Part C — historical-layout natural-language commands
  // ("Format this text like a Vilna Shas folio", "Apply a Shulchan Aruch
  // 2-column layout with commentaries below", "Design a Chassidic Drush
  // page with a decorative Shaar Blatt border", "lay it out like
  // <recipe name>", "change layout", "explain this layout").
  // Local, deterministic parsing — no model call.
  const layoutCmd = parseAutoLayoutCommand(userText);
  if (layoutCmd) {
    return {
      kind: 'action',
      replyHe: layoutCmd.replyHe,
      replyEn: layoutCmd.replyEn,
      action: {
        type: layoutCmd.action,
        label: 'תבנית עימוד היסטורית',
        data: layoutCmd.data,
        diff: { settingName: 'תבנית עימוד', oldValue: '', newValue: '' },
      },
    };
  }

  // Search & replace (Hebrew "החלף X ב-Y" / English "replace X with Y").
  const sr = parseSearchReplaceCommand(userText);
  if (sr) {
    const excerpt = ctx.findTextExcerpt?.(sr.find) ?? null;
    const beforeText = excerpt ?? sr.find;
    const afterText = excerpt ? excerpt.split(sr.find).join(sr.replace) : sr.replace;
    return {
      kind: 'action',
      replyHe: 'מצאתי את הבקשה להחלפה. יש לאשר את ההחלפה בכרטיס למטה — ניתן לבטל אותה לאחר מכן.',
      action: {
        type: 'search_replace',
        label: 'החלפת טקסט',
        data: { find: sr.find, replace: sr.replace },
        diff: { settingName: 'חיפוש והחלפה', beforeText, afterText },
      },
    };
  }

  // Add a commentator from the user's OWN .docx file (never an online library).
  if (
    lower.includes('הוסף מפרש') ||
    lower.includes('הוסף פירוש') ||
    lower.includes('הוסף רש״י') ||
    lower.includes('הוסף תוספות') ||
    lower.includes('add commentator') ||
    lower.includes('add commentary') ||
    lower.includes('add rashi') ||
    lower.includes('add tosafot')
  ) {
    return {
      kind: 'action',
      replyHe: 'אפשר להוסיף מפרש מקובץ DOCX משלך. בחר את קובץ המפרש בכרטיס למטה ואשר — הוא ייובא ויקושר אוטומטית לדיבור המתחיל.',
      action: {
        type: 'add_commentator',
        label: 'הוספת מפרש מקובץ DOCX',
        data: {},
        diff: { settingName: 'מפרש חדש', oldValue: 'אין', newValue: 'קובץ שייבחר' },
      },
    };
  }

  // Proofreading / fix spelling — the auto-fixable text issues.
  if (
    lower.includes('הגהה') ||
    lower.includes('תקן שגיאות כתיב') ||
    lower.includes('תקן את שגיאות') ||
    lower.includes('שגיאות כתיב') ||
    lower.includes('שגיאות הכתיב') ||
    lower.includes('proofread') ||
    lower.includes('fix spelling') ||
    lower.includes('fix the spelling') ||
    lower.includes('spelling mistakes') ||
    lower.includes('correct spelling')
  ) {
    return {
      kind: 'action',
      replyHe: 'מצאתי שגיאות כתיב וניקוד שניתן לתקן אוטומטית. ההצעה היא להחיל את התיקונים — יש לאשר בכרטיס למטה.',
      action: {
        type: 'fix_marked_pages',
        label: 'תיקון שגיאות כתיב וניקוד',
        data: { qualityScore: ctx.qualityScore },
        diff: {
          settingName: 'בדיקת איכות (QA)',
          oldValue: String(ctx.qualityScore),
          newValue: 'תיקונים הוחלו על עמודים מסומנים',
        },
      },
    };
  }

  // Fix QA-flagged pages.
  if (
    lower.includes('תקן עמודים מסומנים') ||
    lower.includes('תקן דפים מסומנים') ||
    lower.includes('תקן עמודים עם בעיות') ||
    lower.includes('fix marked pages') ||
    lower.includes('fix flagged pages') ||
    lower.includes('fix qa issues')
  ) {
    return {
      kind: 'action',
      replyHe: 'מצאתי עמודים שסומנו בבדיקת האיכות. ההצעה היא להחיל את התיקונים על העמודים המסומנים.',
      action: {
        type: 'fix_marked_pages',
        label: 'תיקון עמודים מסומנים',
        data: { qualityScore: ctx.qualityScore },
        diff: {
          settingName: 'בדיקת איכות (QA)',
          oldValue: String(ctx.qualityScore),
          newValue: 'תיקונים הוחלו על עמודים מסומנים',
        },
      },
    };
  }

  // Whole-book balancing (not column balancing — the engine owns that).
  if (
    !norm.includes('column') &&
    !norm.includes('טור') &&
    (norm.includes('balance the book') ||
      norm.includes('balance the whole book') ||
      norm.includes('balance book') ||
      norm.includes('אזן את הספר') ||
      norm.includes('אזן את כל הספר') ||
      norm.includes('איזון הספר') ||
      norm.includes('אזן את הספר מחדש'))
  ) {
    return {
      kind: 'action',
      replyHe: 'ההצעה היא לאזן מחדש את כל הספר — העמודים יאוזנו לגובה אחיד. יש לאשר בכרטיס למטה.',
      action: {
        type: 'balance_book',
        label: 'איזון כל הספר',
        data: {},
        diff: { settingName: 'איזון הספר', newValue: 'איזון מחדש של כל הספר' },
      },
    };
  }

  // Undo the last change.
  if (
    norm.includes('undo') ||
    norm.includes('undo the last') ||
    norm.includes('בטל את השינוי האחרון') ||
    norm.includes('בטל שינוי אחרון') ||
    norm.includes('בטל את השינוי')
  ) {
    return {
      kind: 'action',
      replyHe: 'ההצעה היא לבטל את השינוי האחרון. יש לאשר בכרטיס למטה.',
      action: {
        type: 'undo_last_change',
        label: 'ביטול השינוי האחרון',
        data: {},
        diff: { settingName: 'ביטול', newValue: 'ביטול השינוי האחרון' },
      },
    };
  }

  // Export / cover page / table of contents — opens the export step; the
  // user picks the format and confirms the download there. Nothing is
  // written silently.
  const wantsCover = norm.includes('cover') || norm.includes('עמוד שער') || norm.includes('דף שער');
  const wantsToc =
    norm.includes('table of contents') || norm.includes('תוכן עניינים') || /\btoc\b/.test(norm);
  const wantsExport =
    norm.includes('export') ||
    norm.includes('ייצא') ||
    norm.includes('ייצוא') ||
    norm.includes('הפק') ||
    wantsCover ||
    wantsToc;
  if (wantsExport) {
    let format: ExportFormat = 'pdf';
    if (norm.includes('word') || norm.includes('docx') || norm.includes('וורד')) format = 'docx';
    else if (norm.includes('epub')) format = 'epub';
    else if (norm.includes('html')) format = 'html';
    else if (norm.includes('text') || norm.includes('txt') || norm.includes('טקסט')) format = 'txt';
    else if (norm.includes('idml') || norm.includes('indesign')) format = 'idml';
    else if (norm.includes('pdf')) format = 'pdf';
    const formatName = format === 'docx' ? 'Word' : format.toUpperCase();
    return {
      kind: 'action',
      // Static sentence (translated via t()) + language-neutral format name.
      replyHe:
        'נפתח את שלב הייצוא — שם בוחרים את הפורמט המדויק ומאשרים את ההורדה.' +
        (wantsCover || wantsToc
          ? ' עמוד שער ותוכן עניינים הם אפשרויות בשלב הייצוא — סמן אותן שם לפני ההורדה.'
          : ''),
      replyEn:
        "I'll open the export step — there you pick the exact format and confirm the download." +
        (wantsCover || wantsToc
          ? ' The title page and table of contents are options in the export step — tick them there before downloading.'
          : ''),
      replySuffix: ` (${formatName})`,
      action: {
        type: 'request_export',
        label: 'ייצוא',
        data: { format, includeCover: wantsCover, includeToc: wantsToc },
        diff: {
          settingName: 'ייצוא',
          newValue: 'פתיחת שלב הייצוא',
        },
      },
    };
  }

  // Page add / remove / move / split — no such capability exists in the app
  // (pages are derived from the book's text by pagination). Plain honest
  // reply, never a fake action card.
  if (
    norm.includes('add a page') ||
    norm.includes('add page') ||
    norm.includes('remove a page') ||
    norm.includes('remove page') ||
    norm.includes('delete a page') ||
    norm.includes('delete page') ||
    norm.includes('move a page') ||
    norm.includes('move page') ||
    norm.includes('split a page') ||
    norm.includes('split the page') ||
    norm.includes('split page') ||
    norm.includes('הוסף עמוד') ||
    norm.includes('הוסף דף') ||
    norm.includes('מחק עמוד') ||
    norm.includes('מחק דף') ||
    norm.includes('הסר עמוד') ||
    norm.includes('העבר עמוד') ||
    norm.includes('פצל עמוד') ||
    norm.includes('פצל דף') ||
    norm.includes('פצל את העמוד')
  ) {
    return {
      kind: 'plain',
      replyHe:
        'הוספה, מחיקה, העברה או פיצול של עמודים עדיין לא אפשריים מהעוזר — העמודים נוצרים אוטומטית מהטקסט של הספר. אפשר להוסיף טקסט לספר או לשנות את העיצוב כדי לשנות את חלוקת העמודים.',
    };
  }

  return null;
}

/**
 * v0.4.0 — validates a parsed Gemini action against the REAL action list
 * and the REAL current settings before any approval card is shown.
 * Settings actions are resolved through
 * `DesignSettingsEngine.applyValidatedAiAction` (unknown preset ids, unknown
 * fonts, out-of-range numbers are all rejected); numeric actions are range
 * checked; export/undo/balance take no free-form data. Returns the resolved
 * action (settings actions become `update_design_settings` with the computed
 * settings, applied only if the user approves) or a plain Hebrew rejection
 * — never an action the app cannot safely apply.
 */
export function resolveGeminiAction(
  parsed: NonNullable<ReturnType<typeof parseGeminiActionResponse>>['action'],
  designSettings?: ProfessionalDesignSettings
): { action: NonNullable<ChatMessage['proposedAction']> } | { errorHe: string } {
  if (!parsed) return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
  const type = parsed.type;
  const data = parsed.data ?? {};
  const label = parsed.label;
  const diff = parsed.diff;

  if (type === 'adjust_knee') {
    const y = (data as Record<string, unknown>).kneeJunctionY;
    if (typeof y !== 'number' || !Number.isFinite(y) || y <= 0 || y > 2000) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return { action: { type: 'adjust_knee', label, data: { kneeJunctionY: y }, diff } };
  }
  if (type === 'adjust_spacing') {
    const g = (data as Record<string, unknown>).gutter;
    if (typeof g !== 'number' || !Number.isFinite(g) || g < 6 || g > 36) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return { action: { type: 'adjust_spacing', label, data: { gutter: g }, diff } };
  }
  if (type === 'switch_font' || type === 'update_design_settings' || type === 'apply_ready_design') {
    if (!designSettings) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    const resolved = applyValidatedAiAction(designSettings, type, data);
    if (!resolved) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return {
      action: {
        type: 'update_design_settings',
        label,
        data: { settings: resolved.settings, summaryHe: resolved.summaryHe, summaryEn: resolved.summaryEn },
        diff: diff ?? { settingName: label, newValue: resolved.summaryHe },
      },
    };
  }
  if (type === 'search_replace') {
    const d = data as Record<string, unknown>;
    const find = typeof d.find === 'string' ? d.find.trim() : '';
    const replace = typeof d.replace === 'string' ? d.replace.trim() : '';
    if (!find || find === replace || find.length > 200 || replace.length > 200) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return { action: { type: 'search_replace', label, data: { find, replace }, diff } };
  }
  if (type === 'request_export') {
    const d = data as Record<string, unknown>;
    const format = typeof d.format === 'string' ? d.format.toLowerCase() : 'pdf';
    if (!(EXPORT_FORMATS as ReadonlyArray<string>).includes(format)) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return {
      action: {
        type: 'request_export',
        label,
        data: {
          format,
          includeCover: d.includeCover === true,
          includeToc: d.includeToc === true,
        },
        diff,
      },
    };
  }
  if (
    type === 'fix_qa' ||
    type === 'fix_marked_pages' ||
    type === 'add_commentator' ||
    type === 'balance_book' ||
    type === 'undo_last_change'
  ) {
    return { action: { type: type as AiActionType, label, data: {}, diff } };
  }
  // v0.9.2 Part A (A2): the actions below are advertised in the Gemini
  // system prompt and handled by App.handleApplyAiAdjustment, but the
  // resolver used to reject every one of them as "unknown or unsafe",
  // so Gemini could never actually do them. Each branch validates the
  // payload the App handler consumes before passing it through.
  if (
    type === 'verify_dibbur' ||
    type === 'fix_shas_flaws' ||
    type === 'apply_vilna_defaults' ||
    type === 'verify_folio_sequence' ||
    type === 'check_footer_alignment' ||
    type === 'apply_yiddish_defaults' ||
    type === 'verify_yiddish_folio' ||
    type === 'classify_yiddish_tiers' ||
    type === 'fix_geometry_flaws' ||
    type === 'changeLayout'
  ) {
    // No payload: the App handler derives everything from the document.
    return { action: { type: type as AiActionType, label, data: {}, diff } };
  }
  if (type === 'move_rashi') {
    const closer = (data as Record<string, unknown>).closer;
    if (typeof closer !== 'boolean') {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return { action: { type: 'move_rashi', label, data: { closer }, diff } };
  }
  if (type === 'expand_tosafot') {
    const widthPct = (data as Record<string, unknown>).widthPct;
    if (typeof widthPct !== 'number' || !Number.isFinite(widthPct) || widthPct < 20 || widthPct > 40) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return { action: { type: 'expand_tosafot', label, data: { widthPct }, diff } };
  }
  if (type === 'toggle_michtav') {
    const d = data as Record<string, unknown>;
    if (d.enabled !== undefined && typeof d.enabled !== 'boolean') {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    if (d.text !== undefined && typeof d.text !== 'string') {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return {
      action: {
        type: 'toggle_michtav',
        label,
        data: {
          ...(typeof d.enabled === 'boolean' ? { enabled: d.enabled } : {}),
          ...(typeof d.text === 'string' ? { text: d.text } : {}),
        },
        diff,
      },
    };
  }
  if (type === 'applyHistoricalLayout' || type === 'applyRecipe') {
    const recipeId = (data as Record<string, unknown>).recipeId;
    // A templateId alone names a loaded .keter-template file; no template
    // store exists in this tree, so — like the App handler — refuse it
    // rather than guessing. A recipeId must resolve in the library.
    if (typeof recipeId !== 'string' || !getRecipeByIdLocal(recipeId)) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    return { action: { type: type as AiActionType, label, data: { recipeId }, diff } };
  }
  if (type === 'explainRecipe') {
    const recipeId = (data as Record<string, unknown>).recipeId;
    if (recipeId !== undefined && (typeof recipeId !== 'string' || !getRecipeByIdLocal(recipeId))) {
      return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
    }
    // No recipeId: the App handler explains the current layout's recipe.
    return {
      action: {
        type: 'explainRecipe',
        label,
        data: typeof recipeId === 'string' ? { recipeId } : {},
        diff,
      },
    };
  }
  return { errorHe: 'הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.' };
}

/** Shortens a diff excerpt for the approval card. */
function truncateExcerpt(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  onClose,
  onApplyAdjustment,
  designSettings,
  onUpdateDesignSettings,
  selectedUnitId,
  isDocked = true,
  currentDocumentInfo,
  onOpenGeminiKeyModal,
  geminiKeyVersion = 0,
  onImportCommentaryUnits,
  findTextExcerpt,
}) => {
  const { t, dir, lang } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-1',
      sender: 'ai',
      text: t(
        'שלום! ניתן לבקש בעברית טבעית שינויי גופן, גודל אות, מרווח שורות, עיצוב מוכן, שוליים, ייצוא, איזון הספר או הגהה — כל הצעה מוצגת בכרטיס לאישורך לפני שהיא מוחלת. הדוגמאות למטה מראות מה אפשר לבקש.'
      ),
    },
  ]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [keyPresent, setKeyPresent] = useState<boolean>(() => hasGeminiKey());
  /** v0.3.0 — commentary .docx picked per add_commentator message, awaiting approval. */
  const [commentatorFiles, setCommentatorFiles] = useState<Record<string, File>>({});

  useEffect(() => {
    setKeyPresent(hasGeminiKey());
  }, [geminiKeyVersion]);

  const pushAiMessage = (text: string, action?: ChatMessage['proposedAction']) => {
    const aiMsg: ChatMessage = {
      id: `ai-${Date.now()}`,
      sender: 'ai',
      text,
      proposedAction: action,
      status: action ? 'pending' : undefined,
    };
    setMessages(prev => [...prev, aiMsg]);
  };

  /**
   * v0.4.0 — translates a parsed panel intent into the UI language.
   * Only UI strings go through t(): label, diff settingName/oldValue/
   * newValue. beforeText/afterText are document text and are never
   * translated. The reply suffix (e.g. "(PDF)") is language-neutral.
   */
  const localizeIntent = (
    intent: Extract<PanelIntentResult, { kind: 'action' }>
  ): { text: string; action: ChatMessage['proposedAction'] } => ({
    text: (lang === 'en' && intent.replyEn ? intent.replyEn : t(intent.replyHe)) + (intent.replySuffix ?? ''),
    action: {
      ...intent.action,
      label: t(intent.action.label),
      diff: intent.action.diff
        ? {
            settingName: intent.action.diff.settingName
              ? t(intent.action.diff.settingName)
              : undefined,
            oldValue:
              intent.action.diff.oldValue !== undefined
                ? t(intent.action.diff.oldValue)
                : undefined,
            newValue:
              intent.action.diff.newValue !== undefined
                ? t(intent.action.diff.newValue)
                : undefined,
            beforeText: intent.action.diff.beforeText,
            afterText: intent.action.diff.afterText,
          }
        : undefined,
    },
  });

  /** Local rule-based fallback: panel intents first, then keyword replies. */
  const runLocalFallback = (userText: string) => {
    const lower = userText.toLowerCase();

    // v0.4.0 — panel intents (export / cover / TOC / balance / undo /
    // proofreading / search & replace / add commentator) run before the
    // generic keyword branches, so they always produce a real action.
    const intent = parsePanelIntentCommand(userText, {
      qualityScore: currentDocumentInfo.qualityScore,
      findTextExcerpt,
    });
    if (intent) {
      if (intent.kind === 'action') {
        const localized = localizeIntent(intent);
        pushAiMessage(localized.text, localized.action);
      } else {
        pushAiMessage(lang === 'en' && intent.replyEn ? intent.replyEn : t(intent.replyHe));
      }
      setIsBusy(false);
      return;
    }

    let aiReply = '';
    let action: ChatMessage['proposedAction'] = undefined;

    if (lower.includes('רווח') || lower.includes('צמצם') || lower.includes('spacing')) {
      aiReply = t(
        'זיהיתי את בקשתך לצמצם את הרווח (Gutter) בין עמודת הגמרא לרש״י. ההצעה היא להפחית את הרווח מ-12pt ל-9.5pt.'
      );
      action = {
        type: 'adjust_spacing',
        label: t('הפחתת מרווח עמודות ל-9.5pt'),
        data: { gutter: 9.5 },
      };
    } else if (lower.includes('ברך') || lower.includes('knee') || lower.includes('מדרגה')) {
      aiReply = t(
        'חישבתי מחדש את מתאר מדרגת הברך עבור הדף. לפי אורכי הטקסט של רש״י ותוספות, מומלץ להזיז את צומת המדרגה ל-440pt.'
      );
      action = {
        type: 'adjust_knee',
        label: t('הזזת צומת הברך ל-440pt'),
        data: { kneeJunctionY: 440 },
      };
    } else if (
      lower.includes('תקן') ||
      lower.includes('qa') ||
      lower.includes('יתום') ||
      lower.includes('fix')
    ) {
      aiReply = t(
        'ביצעתי סריקת תקינות לעמוד: אין חפיפות גליפים, סדר הניקוד תקין, וכל נקודות העוגן מתואמות.'
      );
      action = {
        type: 'fix_qa',
        label: t('אישור אופטימיזציית עימוד מלאה'),
        data: {},
      };
    } else {
      const srcSize = designSettings?.roleStyles?.main_source?.character?.fontSizePt ?? 14.5;
      const rashiSize =
        designSettings?.roleStyles?.primary_comment?.character?.fontSizePt ?? 10.5;
      aiReply =
        lang === 'en'
          ? `Got it: "${userText}". Current settings: source ${srcSize}pt, Rashi ${rashiSize}pt. You can ask for example: "Make the text bigger", "Use the classic Vilna look", "Add a cover page", "Fix the spelling mistakes", "Export as PDF", "Balance the book", "Widen the margins", or "Undo the last change".`
          : `קיבלתי: "${userText}". הגדרות נוכחיות: מקור ${srcSize}pt, רש״י ${rashiSize}pt. ניתן לבקש למשל: "הגדל את הטקסט", "השתמש בעיצוב וילנא הקלאסי", "הוסף עמוד שער", "תקן את שגיאות הכתיב", "ייצא כ־PDF", "אזן את הספר", "הרחב את השוליים", או "בטל את השינוי האחרון".`;
    }

    pushAiMessage(aiReply, action);
    setIsBusy(false);
  };

  /** Try Gemini; returns true if it produced a reply, false to fall back local. */
  const runGemini = async (userText: string): Promise<boolean> => {
    const srcSize = designSettings?.roleStyles?.main_source?.character?.fontSizePt ?? 14.5;
    const rashiSize =
      designSettings?.roleStyles?.primary_comment?.character?.fontSizePt ?? 10.5;
    const margins = designSettings?.pageLayout;
    const presetList = READY_DESIGNS.map(p => `${p.id} ("${p.nameEn}")`).join(', ');
    const context = [
      GEMINI_SYSTEM_PROMPT,
      '',
      `Current document: "${currentDocumentInfo.title}", layout ${currentDocumentInfo.layoutPreset}, knee junction ${currentDocumentInfo.kneeJunction}pt, quality score ${currentDocumentInfo.qualityScore}, source font ${srcSize}pt, Rashi font ${rashiSize}pt.`,
      margins
        ? `Margins (pt): top ${margins.marginTopPt}, bottom ${margins.marginBottomPt}, inside ${margins.marginInsidePt}, outside ${margins.marginOutsidePt}; columns ${margins.columnCount}, column gutter ${margins.columnGutterPt}pt; page size ${margins.pageSizePreset}, orientation ${margins.orientation}; running header ${margins.showRunningHeader ? 'on' : 'off'}, page number ${margins.pageNumberPosition}.`
        : '',
      `Ready designs (only these ids exist): ${presetList}.`,
      `Known fonts: ${getFontLibraryFamilies().join(', ')}. (This list includes fonts found on this computer and fonts the user imported; never invent a font name.)`,
      designSettings?.titlePage
        ? `Title page: ${designSettings.titlePage.enabled ? `on — title "${designSettings.titlePage.title.text || currentDocumentInfo.title}", border ${designSettings.titlePage.customBorderImage ? 'custom image' : designSettings.titlePage.border.styleId}` : 'off'}.`
        : '',
    ].join('\n');
    try {
      const raw = await askGemini(userText, context);
      const parsed = parseGeminiActionResponse(raw);
      if (parsed) {
        if (parsed.action) {
          // v0.4.0 — validate against the real action list + real settings
          // before any approval card is shown; unknown/unsafe → plain message.
          const resolved = resolveGeminiAction(parsed.action, designSettings);
          if ('errorHe' in resolved) {
            pushAiMessage(t(resolved.errorHe));
            setIsBusy(false);
            return true;
          }
          const action = resolved.action;
          // Translate a settings-action diff summary into the UI language.
          if (action.type === 'update_design_settings') {
            const summary =
              lang === 'en'
                ? (action.data.summaryEn as string) || (action.data.summaryHe as string)
                : (action.data.summaryHe as string);
            if (action.diff && action.diff.newValue === (action.data.summaryHe as string)) {
              action.diff = { ...action.diff, newValue: summary };
            }
          }
          pushAiMessage(parsed.reply.trim(), action);
        } else {
          pushAiMessage(parsed.reply.trim());
        }
        setIsBusy(false);
        return true;
      }
      if (raw.trim()) {
        // Not JSON — show the raw reply as text-only.
        pushAiMessage(raw.trim());
        setIsBusy(false);
        return true;
      }
      return false;
    } catch (err) {
      // v0.3.2 — show the specific reason, not a generic "Gemini error".
      const info = describeGeminiError(err);
      const reason = t(GEMINI_ERROR_HEBREW[info.kind]);
      setGeminiError(info.detail ? `${reason} — ${info.detail}` : reason);
      return false;
    }
  };

  const sendTextCommand = (rawCommand: string) => {
    const userText = rawCommand.trim();
    if (!userText || isBusy) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: userText,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setGeminiError(null);
    setIsBusy(true);

    setTimeout(() => {
      // 1. Local natural-language parser first: exact, offline, no cost.
      // v0.4.0 — a matched command now proposes an approval card (with a
      // before/after diff) instead of applying immediately: NOTHING is ever
      // applied without the user's approval. On Approve, handleApprove
      // calls onUpdateDesignSettings with the precomputed settings.
      if (designSettings && onUpdateDesignSettings) {
        const nlRes = DesignSettingsEngine.applyNaturalLanguageCommand(
          designSettings,
          userText,
          'ai',
          selectedUnitId ?? undefined
        );
        if (nlRes.matched) {
          const summary = lang === 'en' ? nlRes.summaryEn || nlRes.summaryHe : nlRes.summaryHe;
          pushAiMessage(
            lang === 'en'
              ? `I can make this change — please approve it on the card below: ${summary}`
              : `אפשר לבצע את השינוי — יש לאשר אותו בכרטיס למטה: ${summary}`,
            {
              type: 'update_design_settings',
              label: t('עדכון עיצוב'),
              data: {
                settings: nlRes.updatedSettings,
                summaryHe: nlRes.summaryHe,
                summaryEn: nlRes.summaryEn,
              },
              diff: { settingName: t('שינוי עיצוב'), newValue: summary },
            }
          );
          setIsBusy(false);
          return;
        }
      }

      // 2. Panel intents (export / cover / TOC / balance / undo /
      // proofreading / search & replace / add commentator): exact, offline.
      const intent = parsePanelIntentCommand(userText, {
        qualityScore: currentDocumentInfo.qualityScore,
        findTextExcerpt,
      });
      if (intent) {
        if (intent.kind === 'action') {
          const localized = localizeIntent(intent);
          pushAiMessage(localized.text, localized.action);
        } else {
          pushAiMessage(lang === 'en' && intent.replyEn ? intent.replyEn : t(intent.replyHe));
        }
        setIsBusy(false);
        return;
      }

      // 3. Gemini when a key is set; 4. local canned replies as fallback.
      if (keyPresent) {
        void runGemini(userText).then(handled => {
          if (!handled) runLocalFallback(userText);
        });
      } else {
        runLocalFallback(userText);
      }
    }, 250);
  };

  const handleSend = () => {
    sendTextCommand(input);
  };

  const handleApprove = (msgId: string, action: ChatMessage['proposedAction']) => {
    if (!action) return;
    // v0.4.0 — settings changes (local parser results and validated Gemini
    // actions) are applied HERE, only on Approve, through the existing
    // onUpdateDesignSettings path — the same handler the Design panel uses,
    // so the change is undoable through the existing history.
    if (action.type === 'update_design_settings') {
      const settings = (action.data as { settings?: ProfessionalDesignSettings } | undefined)
        ?.settings;
      const summaryHe = (action.data as { summaryHe?: string } | undefined)?.summaryHe;
      if (!settings || !onUpdateDesignSettings) {
        pushAiMessage(t('הפעולה שהוצעה לא מוכרת או לא בטוחה — היא לא הוחלה.'));
        setMessages(prev =>
          prev.map(m => (m.id === msgId ? { ...m, status: 'rejected' as const } : m))
        );
        return;
      }
      onUpdateDesignSettings(settings, summaryHe ?? action.label);
      setMessages(prev =>
        prev.map(m => (m.id === msgId ? { ...m, status: 'approved' as const } : m))
      );
      return;
    }
    // v0.3.0 — add_commentator imports the picked .docx through the existing
    // importer + App import path (undoable), instead of a settings change.
    if (action.type === 'add_commentator') {
      const file = commentatorFiles[msgId];
      if (!file) return; // Approve stays disabled until a file is picked.
      if (!onImportCommentaryUnits) {
        pushAiMessage(
          t('הוספת מפרש עדיין לא מחוברת בחלון הראשי — יש לחבר את onImportCommentaryUnits.')
        );
        setMessages(prev =>
          prev.map(m => (m.id === msgId ? { ...m, status: 'rejected' as const } : m))
        );
        return;
      }
      void (async () => {
        try {
          const buffer = await file.arrayBuffer();
          const res = await DocxImporter.importDocx(buffer, file.name);
          onImportCommentaryUnits(
            res.units,
            res.metadata.title || file.name.replace(/\.docx$/i, ''),
            res.links
          );
          // v0.8.0 Part E: surface import warnings (dropped images, …)
          // in the chat instead of swallowing them with the approval.
          if (res.validation.warnings.length > 0) {
            pushAiMessage(
              t('אזהרות יבוא מהמפרש: ') + res.validation.warnings.join(' ')
            );
          }
          setMessages(prev =>
            prev.map(m => (m.id === msgId ? { ...m, status: 'approved' as const } : m))
          );
          setCommentatorFiles(prev => {
            const next = { ...prev };
            delete next[msgId];
            return next;
          });
        } catch (err: any) {
          pushAiMessage(t('שגיאה ביבוא קובץ המפרש: ') + (err?.message || t('קובץ שגוי')));
        }
      })();
      return;
    }
    setMessages(prev =>
      prev.map(m => (m.id === msgId ? { ...m, status: 'approved' as const } : m))
    );
    onApplyAdjustment(action.type, action.data);
  };

  const handleReject = (msgId: string) => {
    setMessages(prev =>
      prev.map(m => (m.id === msgId ? { ...m, status: 'rejected' as const } : m))
    );
  };

  // v0.9.8 Bilingual Audit — the drawer mirrors with the document
  // direction: it docks on the start side (right in Hebrew, left in
  // English) and its inner border faces the canvas. Before this fix the
  // floating drawer was hard-coded to the left in both languages.
  const containerClass = isDocked
    ? `flex flex-col h-full min-h-0 bg-[var(--ui-surface)] text-[var(--ui-text-primary)] select-none overflow-hidden ${dir === 'rtl' ? 'border-l' : 'border-r'} border-[var(--ui-border)] transition-colors duration-150`
    : `fixed inset-y-0 ${dir === 'rtl' ? 'right-0' : 'left-0'} w-88 bg-[var(--ui-surface)] ${dir === 'rtl' ? 'border-l' : 'border-r'} border-[var(--ui-border)] shadow-[var(--ui-floating-shadow)] z-40 flex flex-col text-[var(--ui-text-primary)]`;

  return (
    <aside dir={dir} className={containerClass}>
      {/* Header */}
      <div className="px-4 py-3.5 bg-[var(--ui-surface)] border-b border-[var(--ui-border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-selected-border)] flex items-center justify-center text-[var(--ui-accent)]">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-[var(--ui-text-primary)]">{t('עוזר עימוד חכם')}</h2>
            <p className="text-[11px] text-[var(--ui-text-secondary)]">
              {t('פקודות בעברית טבעית לעיצוב הספר')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!keyPresent && onOpenGeminiKeyModal && (
            <button
              onClick={onOpenGeminiKeyModal}
              className="p-1.5 hover:bg-[var(--ui-surface-hover)] rounded-lg text-[var(--ui-accent)] hover:text-[var(--ui-text-primary)] transition-colors"
              title={t('הוסף מפתח Gemini')}
            >
              <KeyRound className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[var(--ui-surface-hover)] rounded-lg text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
              title={t('סגור חלונית AI')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Prompts Bar */}
      <div className="p-3 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex flex-wrap gap-1.5 shrink-0">
        {QUICK_AI_PROMPTS.map(prompt => (
          <button
            key={prompt}
            onClick={() => sendTextCommand(prompt)}
            className="px-2.5 py-1 rounded-lg bg-[var(--ui-surface)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
          >
            {t(prompt)}
          </button>
        ))}
      </div>

      {/* v0.4.0 — "What can I ask?" examples, so a first-time user sees what
          the assistant can do. Plain words, Hebrew + English via t(). */}
      <div className="px-3 py-2 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] shrink-0">
        <p className="text-[11px] font-semibold text-[var(--ui-text-secondary)] mb-1.5">
          {t('מה אפשר לבקש?')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {AI_EXAMPLE_PROMPTS.map(prompt => (
            <button
              key={prompt}
              onClick={() => sendTextCommand(prompt)}
              className="px-2.5 py-1 rounded-full bg-[var(--ui-selected-bg)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-selected-border)] text-[11px] text-[var(--ui-accent)] hover:text-[var(--ui-text-primary)] transition-colors"
            >
              {t(prompt)}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 text-xs leading-relaxed">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-start' : 'items-end'}`}
          >
            <div
              className={`p-3 rounded-xl max-w-[92%] ${
                msg.sender === 'user'
                  ? 'bg-[var(--ui-accent)] text-[var(--ui-accent-fg)] font-medium'
                  : 'bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] text-[var(--ui-text-primary)]'
              }`}
            >
              <p>{msg.text}</p>

              {msg.proposedAction && (
                <div className="mt-2.5 pt-2 border-t border-[var(--ui-border)] bg-[var(--ui-surface)] rounded-lg p-2.5">
                  <div className="flex items-center gap-1.5 text-[var(--ui-accent)] font-semibold mb-1 text-[11px]">
                    <Sparkles className="w-3 h-3" />
                    <span>{t('הצעה לאישורך:')}</span>
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)] mb-2 font-mono">
                    {msg.proposedAction.label}
                  </p>

                  {/* v0.3.0 — before/after diff: setting old → new, and for text
                      changes the affected text before/after (short excerpts). */}
                  {msg.proposedAction.diff && (
                    <div className="mb-2 space-y-1.5 text-[11px]">
                      {msg.proposedAction.diff.settingName && (
                        <p className="text-[var(--ui-text-secondary)]">
                          <span className="font-semibold text-[var(--ui-text-primary)]">
                            {msg.proposedAction.diff.settingName}:{' '}
                          </span>
                          {msg.proposedAction.diff.oldValue !== undefined && (
                            <>
                              <span className="line-through opacity-70">
                                {msg.proposedAction.diff.oldValue}
                              </span>
                              {' → '}
                            </>
                          )}
                          {msg.proposedAction.diff.newValue !== undefined && (
                            <span className="font-medium">{msg.proposedAction.diff.newValue}</span>
                          )}
                        </p>
                      )}
                      {(msg.proposedAction.diff.beforeText !== undefined ||
                        msg.proposedAction.diff.afterText !== undefined) && (
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="rounded-md bg-rose-500/10 border border-rose-500/30 p-1.5">
                            <p className="text-[10px] font-semibold text-rose-400 mb-0.5">
                              {t('לפני')}
                            </p>
                            <p className="text-[var(--ui-text-primary)] break-words">
                              {truncateExcerpt(msg.proposedAction.diff.beforeText ?? '')}
                            </p>
                          </div>
                          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-1.5">
                            <p className="text-[10px] font-semibold text-emerald-400 mb-0.5">
                              {t('אחרי')}
                            </p>
                            <p className="text-[var(--ui-text-primary)] break-words">
                              {truncateExcerpt(msg.proposedAction.diff.afterText ?? '')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* v0.3.0 — add_commentator: pick the user's own commentary .docx.
                      The file is imported only after approval. */}
                  {msg.proposedAction.type === 'add_commentator' && msg.status === 'pending' && (
                    <label className="mb-2 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-md border border-dashed border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] cursor-pointer">
                      <input
                        type="file"
                        accept=".docx"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) setCommentatorFiles(prev => ({ ...prev, [msg.id]: f }));
                        }}
                      />
                      <FileUp className="w-3.5 h-3.5" />
                      <span>
                        {commentatorFiles[msg.id]
                          ? commentatorFiles[msg.id].name
                          : t('בחר קובץ DOCX של המפרש')}
                      </span>
                    </label>
                  )}

                  {msg.status === 'pending' ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(msg.id, msg.proposedAction)}
                        disabled={
                          msg.proposedAction.type === 'add_commentator' &&
                          !commentatorFiles[msg.id]
                        }
                        className="flex-1 py-1.5 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-40 text-[var(--ui-accent-fg)] rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Check className="w-3 h-3" />
                        <span>{t('אישור')}</span>
                      </button>
                      <button
                        onClick={() => handleReject(msg.id)}
                        className="flex-1 py-1.5 bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] rounded-md text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        <span>{t('דחייה')}</span>
                      </button>
                    </div>
                  ) : msg.status === 'approved' ? (
                    <span className="text-[var(--ui-success)] font-medium text-[11px] flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>{t('השינוי אושר והוחל על הספר')}</span>
                    </span>
                  ) : (
                    <span className="text-[var(--ui-text-muted)] font-medium text-[11px]">
                      {t('השינוי נדחה')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Gemini error note */}
      {geminiError && (
        <div className="px-3.5 pt-2 bg-[var(--ui-surface)] text-[11px] text-amber-500 shrink-0">
          {geminiError}
        </div>
      )}

      {/* Input */}
      <div className="p-3.5 bg-[var(--ui-surface)] border-t border-[var(--ui-border)] flex items-center gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder={t('בקש שינוי גופן, מרווח שורות, יישור, ברכיים...')}
          className="flex-1 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:border-[var(--ui-accent)]"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isBusy}
          className="px-3.5 py-2 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-40 text-[var(--ui-accent-fg)] rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{t('שלח')}</span>
        </button>
      </div>
    </aside>
  );
};
