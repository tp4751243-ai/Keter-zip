import { GoogleGenAI } from '@google/genai';

/**
 * Gemini service (v0.2.0, error handling added in v0.3.2).
 *
 * There was no Gemini integration in the app before v0.2.0 — the "AI
 * suggestions" were a local Hebrew/English keyword parser plus canned replies
 * (see AiChatPanel / DesignSettingsEngine.applyNaturalLanguageCommand).
 * This module adds the real model call; the local parser stays as the
 * fallback when no key is set or the request fails.
 *
 * Key resolution order:
 *   1. localStorage 'keter.geminiApiKey' (saved from the GeminiKeyModal)
 *   2. import.meta.env.VITE_GEMINI_API_KEY (dev only — Vite only exposes
 *      VITE_-prefixed vars to the renderer, so the old plain GEMINI_API_KEY
 *      from .env could never reach the installed app)
 *
 * Call shape verified against @google/genai 2.32.0 (what ^2.4.0 resolves to):
 *   new GoogleGenAI({ apiKey })
 *   ai.models.generateContent({ model, contents }) -> response.text
 *
 * Key formats (Google AI Studio, since 28 May 2026):
 *   - Current "auth keys": start with `AQ.` and are about 53 characters
 *     (service-account backed). This is what AI Studio issues today.
 *   - Legacy keys: start with `AIza` and are 39 characters.
 * Both are valid API keys. The shape check below only rejects what is
 * decidably NOT an API key (empty, too short, internal whitespace, an
 * OAuth access token `ya29.` or a JWT `eyJ...`); anything else is left
 * for Google to decide via the live Test key call — never by prefix.
 *
 * v0.3.4 — why AQ. keys still failed (deep check, 2026-11-08):
 *   1. DEAD MODEL (primary root cause): the app called `gemini-2.5-flash`.
 *      Google deprecated it on 2 Nov 2026 and limited API access to users
 *      who had actively used the 2.5 models before — a brand-new user with
 *      a fresh AQ. key never used them, so EVERY call failed (404) no
 *      matter how valid the key was. Google's named replacement is
 *      `gemini-3.5-flash-lite` (GA, no shutdown date announced); the app
 *      now calls that, retrying once with `gemini-3.8-flash` if the
 *      primary model 404s. Sources: ai.google.dev/gemini-api/docs/deprecations
 *      (fetched live 2026-11-08) and the 2 Nov 2026 changelog entry.
 *   2. DOUBLE CLASSIFICATION (display bug): askGemini already classifies
 *      into GeminiRequestError, but the key modal and chat panel passed
 *      that error through describeGeminiError again; its Hebrew message
 *      has no JSON body and no status, so it came back as 'unknown' and
 *      the user saw a garbled generic line. describeGeminiError now
 *      passes GeminiRequestError through unchanged.
 *   3. 401 ACCESS_TOKEN_TYPE_UNSUPPORTED: a real, widely reported failure
 *      of AQ. auth keys (Google developer forum, Oct 2026) that the old
 *      classifier mislabelled as "key not valid". New kind
 *      'auth_key_rejected' explains it and points at the documented
 *      workaround (a standard key from Google Cloud Console).
 * Ruled out by re-checking: SDK transport (header only, no `?key=`,
 * no prefix branching — re-read in node_modules below), no CSP in
 * index.html/electron, key storage/trimming (saveGeminiKey strips all
 * whitespace; the Test flow saves then reads back the same key).
 * SDK version: 2.32.0 is the latest 2.x; 3.0.0 exists but 401 reports
 * include users on the latest SDK, so a major-version bump is not an
 * evidenced fix and was not taken.
 *
 * Transport verified against @google/genai 2.32.0 (node_modules):
 * the SDK sends the key ONLY as the `x-goog-api-key` HTTP header
 * (WebAuth.addAuthHeaders / applyAuth in dist/web/index.mjs; the REST
 * request path calls addAuthHeaders before every fetch). It never puts
 * the key in a `?key=` query parameter for generateContent (the only
 * `?key=` in the SDK is the live-API WebSocket music endpoint, which
 * this app never calls). That matters because `AQ.` keys authenticate
 * only via the header — a `?key=` request would fail with
 * 401 ACCESS_TOKEN_TYPE_UNSUPPORTED. No SDK change is needed.
 *
 * Error shapes verified against @google/genai 2.32.0 (node_modules):
 *   - HTTP failures throw `ApiError` (name 'ApiError') with a numeric
 *     `status` and a `message` that is the JSON-stringified Google error
 *     body, e.g. {"error":{"code":400,"message":"API key not valid. Please
 *     pass a valid API key.","status":"INVALID_ARGUMENT"}}. The `status`
 *     string inside the body is one of INVALID_ARGUMENT, UNAUTHENTICATED,
 *     PERMISSION_DENIED, NOT_FOUND, RESOURCE_EXHAUSTED, etc.
 *   - Streaming errors throw ApiError with message
 *     `got status: <status>. {<same JSON body>}`.
 *   - Network failures (offline, DNS, blocked) never reach the API: the
 *     SDK's fetch throws a TypeError such as "Failed to fetch" (Chromium)
 *     or "fetch failed" (undici) — no status at all.
 * `describeGeminiError` maps those real shapes to a user-facing kind; it
 * never invents a reason — anything it cannot recognise is 'unknown' and
 * still carries the underlying message as detail.
 */

export const GEMINI_API_KEY_STORAGE_KEY = 'keter.geminiApiKey';
/**
 * v0.3.4 — `gemini-2.5-flash` is dead for new users: Google deprecated it
 * on 2 Nov 2026 and limited API access to users who had actively used the
 * 2.5 models before, so a fresh AQ. key fails every call with 404.
 * Google's named replacement is `gemini-3.5-flash-lite`; `gemini-3.8-flash`
 * is the one-time fallback if the primary model is not available.
 * Source: ai.google.dev/gemini-api/docs/deprecations (live, 2026-11-08).
 */
export const GEMINI_MODEL: string = 'gemini-3.5-flash-lite';
export const GEMINI_FALLBACK_MODEL: string = 'gemini-3.8-flash';

/**
 * v0.4.0 — every action type Gemini may propose, and the panel may show on
 * an approval card. The list is the single source of truth: the system
 * prompt (AiChatPanel) offers exactly these, and the panel rejects anything
 * else before a card is ever shown. Settings-changing types are validated
 * field-by-field against the real settings by
 * `DesignSettingsEngine.applyValidatedAiAction`; `balance_book` /
 * `request_export` / `undo_last_change` are executed by App's
 * `handleApplyAiAdjustment` (balance re-run, export step, undo) and never
 * write a file or change text on their own.
 *
 * Data shapes (all validated in AiChatPanel before the card is shown):
 * - adjust_knee {kneeJunctionY: pt} · adjust_spacing {gutter: pt}
 * - fix_qa {} · fix_marked_pages {} · balance_book {}
 * - switch_font {role?, fontFamily} (fontFamily must be a known holy-book font)
 * - update_design_settings {patch: AiSettingsPatch} (see design-settings-engine)
 * - apply_ready_design {presetId} (must be a READY_DESIGNS id)
 * - add_commentator {} (user picks their own .docx in the card)
 * - search_replace {find, replace}
 * - verify_dibbur {} · fix_shas_flaws {} · apply_vilna_defaults {}
 *   move_rashi {} · expand_tosafot {} · verify_folio_sequence {}
 *   check_footer_alignment {} (Vilna Shas — all handled in App)
 * - apply_yiddish_defaults {} · verify_yiddish_folio {}
 *   classify_yiddish_tiers {} (v0.8.0 Part D — Yiddish sefarim, handled in App:
 *   apply Yiddish heading defaults, verify Yiddish folio sequence, or
 *   re-classify the book's units as Tzenerene / translation / Biur /
 *   Hebrew source)
 * - applyHistoricalLayout {recipeId} · applyRecipe {recipeId | templateId}
 *   explainRecipe {recipeId?} · changeLayout {} (v0.9.0 Part C — historical
 *   layout recipes, handled in App: lay the document out with a historical
 *   recipe, apply a recipe or a loaded .keter-template, explain a recipe,
 *   or open the layout picker. A templateId that is not a loaded template
 *   is refused, never guessed. See auto-layout.ts for the recipe catalogue
 *   and the local NL parser parseAutoLayoutCommand.)
 *   v0.9.3 Part C — the same validated types now cover 18 more recipes:
 *   the contract NL phrases in RESEARCH-NOTE.md ("Format this like an Oz
 *   VeHadar Shas page" → shas-oz-vehadar, "Yerushalmi page" →
 *   yerushalmi, "Kehati Mishnah" → mishnah-kehati, "Steinsaltz page" →
 *   shas-steinzaltz, …) are wired in the unified library
 *   (historical-layouts.ts: HISTORICAL_RECIPE_RULES /
 *   HISTORICAL_RECIPE_ALIASES) and listed in the Gemini
 *   prompt context by buildRecipePromptContext; AiChatPanel validates
 *   the recipeId against getRecipeByIdLocal before any approval card.
 *   No new action type was needed — the v0.9.0 types already validate
 *   recipe ids, so no new fake capability is introduced here.
 * - fix_geometry_flaws {} (v0.9.0 Part C — apply the corrective geometry
 *   shifts from the extended flaw scan: gutter widening for text overlaps,
 *   knee-junction shift for misaligned knees; capped, via approval card.)
 * - request_export {format: 'pdf'|'docx'|'epub'|'html'|'txt'|'idml', includeCover?, includeToc?}
 *   (only opens the export step — the user picks the format and confirms there)
 * - undo_last_change {}
 */
export const GEMINI_ACTION_TYPES: ReadonlyArray<string> = Object.freeze([
  'adjust_knee',
  'adjust_spacing',
  'fix_qa',
  'switch_font',
  'update_design_settings',
  'add_commentator',
  'search_replace',
  'fix_marked_pages',
  'apply_ready_design',
  'balance_book',
  'request_export',
  'undo_last_change',
  // v0.7.0 Part 3 (M2) — Vilna Shas actions (all handled in App).
  'verify_dibbur',
  'fix_shas_flaws',
  'apply_vilna_defaults',
  'move_rashi',
  'expand_tosafot',
  'verify_folio_sequence',
  'check_footer_alignment',
  // v0.8.0 Part C (§7) — Michtav box toggle (handled in App).
  'toggle_michtav',
  // v0.8.0 Part D — Yiddish sefarim actions (all handled in App).
  'apply_yiddish_defaults',
  'verify_yiddish_folio',
  'classify_yiddish_tiers',
  // v0.9.0 Part C — historical layout recipes + geometry flaw fixes (all handled in App).
  'applyHistoricalLayout',
  'applyRecipe',
  'explainRecipe',
  'changeLayout',
  'fix_geometry_flaws',
]);

export function isKnownGeminiActionType(type: string): boolean {
  return (GEMINI_ACTION_TYPES as ReadonlyArray<string>).includes(type);
}

/** A parsed Gemini {"reply","action"} response (shape-checked only). */
export interface ParsedGeminiAction {
  reply: string;
  action?: {
    type: string;
    label: string;
    data: Record<string, unknown>;
    diff?: {
      settingName?: string;
      oldValue?: string;
      newValue?: string;
      beforeText?: string;
      afterText?: string;
    };
  };
}

/**
 * v0.4.0 — parses a Gemini reply into {"reply","action"} and checks only
 * the shape: reply must be a non-empty string; an action must have a known
 * type, a string label, and an object data. Returns null when the text is
 * not that JSON shape (callers then show the raw text as a text-only reply).
 * Semantic validation (real settings, real preset ids, safe ranges) is NOT
 * done here — AiChatPanel does it before any approval card is shown.
 */
export function parseGeminiActionResponse(raw: string): ParsedGeminiAction | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.reply !== 'string' || !obj.reply.trim()) return null;
  const result: ParsedGeminiAction = { reply: obj.reply.trim() };
  if (obj.action && typeof obj.action === 'object') {
    const a = obj.action as Record<string, unknown>;
    if (
      typeof a.type === 'string' &&
      isKnownGeminiActionType(a.type) &&
      typeof a.label === 'string' &&
      a.label.trim()
    ) {
      const rawDiff = a.diff;
      const diff =
        rawDiff && typeof rawDiff === 'object'
          ? {
              settingName:
                typeof (rawDiff as Record<string, unknown>).settingName === 'string'
                  ? (rawDiff as Record<string, unknown>).settingName as string
                  : undefined,
              oldValue:
                typeof (rawDiff as Record<string, unknown>).oldValue === 'string'
                  ? (rawDiff as Record<string, unknown>).oldValue as string
                  : undefined,
              newValue:
                typeof (rawDiff as Record<string, unknown>).newValue === 'string'
                  ? (rawDiff as Record<string, unknown>).newValue as string
                  : undefined,
              beforeText:
                typeof (rawDiff as Record<string, unknown>).beforeText === 'string'
                  ? (rawDiff as Record<string, unknown>).beforeText as string
                  : undefined,
              afterText:
                typeof (rawDiff as Record<string, unknown>).afterText === 'string'
                  ? (rawDiff as Record<string, unknown>).afterText as string
                  : undefined,
            }
          : undefined;
      result.action = {
        type: a.type,
        label: a.label.trim(),
        data:
          a.data && typeof a.data === 'object' ? (a.data as Record<string, unknown>) : {},
        diff,
      };
    }
  }
  return result;
}

/**
 * v0.3.3 — permissive shape check for a Gemini API key.
 *
 * Google AI Studio now issues "auth keys" starting with `AQ.` (about 53
 * characters); older keys start with `AIza` (39 characters). Both work,
 * and future formats may exist. This check therefore only rejects what
 * is decidably NOT an API key:
 *   - empty, or shorter than 20 characters once whitespace is stripped
 *   - contains internal whitespace (a real key never does)
 *   - looks like an OAuth access token (`ya29.`) or a JWT (`eyJ...`)
 * Anything else is accepted here — whether it is actually valid is
 * Google's call, decided by the live Test key call, never by this check.
 * (v0.3.2 wrongly required the `AIza` prefix, so every current `AQ.`
 * key was flagged as suspicious even though it is the valid format.)
 */
export function looksLikeGoogleApiKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (/\s/.test(trimmed)) return false;
  if (trimmed.length < 20) return false;
  if (trimmed.startsWith('ya29.')) return false;
  if (trimmed.startsWith('eyJ')) return false;
  return true;
}

export type GeminiErrorKind =
  | 'invalid_key'
  | 'api_not_enabled'
  | 'permission_denied'
  | 'model_not_found'
  | 'quota'
  | 'network'
  | 'empty_response'
  | 'auth_key_rejected'
  | 'unknown';

/**
 * Hebrew UI literal for each error kind. UI components pass these through
 * t() (see src/i18n/strings.ts) so they render in Hebrew and English.
 */
export const GEMINI_ERROR_HEBREW: Record<GeminiErrorKind, string> = {
  invalid_key:
    'שגיאת Gemini: המפתח לא תקין — בדוק שהעתקת את המפתח הנכון מ־Google AI Studio ונסה שוב.',
  api_not_enabled:
    'שגיאת Gemini: ה־API לא מופעל בפרויקט של המפתח — הפעל את Generative Language API ב־Google Cloud ונסה שוב.',
  permission_denied:
    'שגיאת Gemini: אין הרשאה למפתח הזה — ייתכן שהמפתח מוגבל, בדוק את ההגבלות שלו ב־Google Cloud.',
  model_not_found:
    'שגיאת Gemini: המודל לא נמצא — ייתכן שהוא אינו זמין למפתח הזה.',
  quota:
    'שגיאת Gemini: חרגת מהמכסה או נשלחו יותר מדי בקשות — המתן מעט ונסה שוב.',
  network:
    'שגיאת Gemini: אין חיבור לאינטרנט — בדוק את החיבור ונסה שוב.',
  empty_response: 'שגיאת Gemini: התקבלה תשובה ריקה — נסה שוב.',
  auth_key_rejected:
    'שגיאת Gemini: Google לא מקבלת את מפתח ה־AQ. הזה — בעיה ידועה עם מפתחות Auth חדשים, המפתח עצמו כנראה תקין. צור מפתח רגיל ב־Google Cloud Console (Credentials ← Create API key, מוגבל ל־Gemini API) והשתמש בו במקום.',
  unknown: 'שגיאת Gemini — ממשיך עם כללים מקומיים',
};

export interface GeminiErrorInfo {
  kind: GeminiErrorKind;
  /** Short detail from the API itself (English, as returned by Google), or ''. */
  detail: string;
}

const DETAIL_MAX_LENGTH = 160;

function truncateDetail(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > DETAIL_MAX_LENGTH
    ? `${cleaned.slice(0, DETAIL_MAX_LENGTH - 1)}…`
    : cleaned;
}

/** Pull the Google error body out of an ApiError message (plain or stream form). */
function parseGoogleErrorBody(message: string): {
  code?: number;
  statusText?: string;
  message?: string;
} {
  const start = message.indexOf('{');
  if (start < 0) return {};
  try {
    const parsed: unknown = JSON.parse(message.slice(start));
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const err = (parsed as { error: unknown }).error;
      if (err && typeof err === 'object') {
        const e = err as { code?: unknown; status?: unknown; message?: unknown };
        return {
          code: typeof e.code === 'number' ? e.code : undefined,
          statusText: typeof e.status === 'string' ? e.status : undefined,
          message: typeof e.message === 'string' ? e.message : undefined,
        };
      }
    }
  } catch {
    // Not JSON — fall through with no body details.
  }
  return {};
}

function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof TypeError) {
    return /failed to fetch|fetch failed|network ?error|network request failed|load failed|offline|econnrefused|enotfound|etimedout/i.test(
      err.message
    );
  }
  const message = err instanceof Error ? err.message : '';
  return /failed to fetch|fetch failed|network ?error|network request failed/i.test(message);
}

/**
 * Map a thrown error to a user-facing kind + detail.
 * Only maps shapes the SDK actually produces (see header comment); anything
 * unrecognised is 'unknown' with the underlying message as detail.
 */
export function describeGeminiError(err: unknown): GeminiErrorInfo {
  // v0.3.4 — askGemini already classifies into GeminiRequestError, and the
  // key modal / chat panel pass that error back here. Pass it through
  // unchanged: re-classifying its Hebrew message would lose the kind and
  // come back as 'unknown' (that is what hid the real reason in v0.3.3).
  if (err instanceof GeminiRequestError) {
    return { kind: err.kind, detail: err.detail };
  }
  if (isNetworkError(err)) {
    return { kind: 'network', detail: '' };
  }
  const message = err instanceof Error ? err.message : String(err ?? '');
  const rawStatus = (err as { status?: unknown } | null)?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;
  const body = parseGoogleErrorBody(message);
  const googleStatus = body.statusText ?? '';
  const googleMessage = body.message ?? '';
  const detail = googleMessage
    ? truncateDetail(googleMessage)
    : status !== undefined
      ? `HTTP ${status}`
      : truncateDetail(message);
  const haystack = `${googleStatus} ${googleMessage} ${message}`.toLowerCase();

  // v0.3.4 — 401 ACCESS_TOKEN_TYPE_UNSUPPORTED: Google's backend rejects
  // this AQ. auth key ("Expected OAuth 2 access token..."). This is a
  // known, widely reported failure of some AI Studio auth keys (Google
  // developer forum, Oct 2026) — the key itself is usually fine, so it
  // must NOT read as "key not valid". The raw Google detail is deliberately
  // dropped here: it is the misleading OAuth sentence.
  if (/access_token_type_unsupported|expected oauth 2 access token/i.test(haystack)) {
    return { kind: 'auth_key_rejected', detail: '' };
  }

  if (
    status === 400 ||
    status === 401 ||
    googleStatus === 'INVALID_ARGUMENT' ||
    googleStatus === 'UNAUTHENTICATED'
  ) {
    if (/api key/i.test(haystack) || googleStatus === 'UNAUTHENTICATED') {
      return { kind: 'invalid_key', detail };
    }
    return { kind: 'unknown', detail };
  }
  if (status === 403 || googleStatus === 'PERMISSION_DENIED') {
    if (/has not been used|is disabled|not been enabled|api not enabled|service .* disabled/i.test(haystack)) {
      return { kind: 'api_not_enabled', detail };
    }
    return { kind: 'permission_denied', detail };
  }
  if (status === 404 || googleStatus === 'NOT_FOUND') {
    return { kind: 'model_not_found', detail };
  }
  if (status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') {
    return { kind: 'quota', detail };
  }
  return { kind: 'unknown', detail };
}

export class GeminiKeyMissingError extends Error {
  constructor() {
    super('No Gemini API key is set.');
    this.name = 'GeminiKeyMissingError';
  }
}

export class GeminiRequestError extends Error {
  readonly kind: GeminiErrorKind;
  readonly detail: string;
  readonly cause?: unknown;
  constructor(kind: GeminiErrorKind, detail = '', cause?: unknown) {
    super(GEMINI_ERROR_HEBREW[kind]);
    this.name = 'GeminiRequestError';
    this.kind = kind;
    this.detail = detail;
    this.cause = cause;
  }
}

export function getGeminiKey(): string | null {
  try {
    const stored = localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // ignore storage errors
  }
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (typeof envKey === 'string' && envKey.trim()) {
    return envKey.trim();
  }
  return null;
}

export function hasGeminiKey(): boolean {
  return getGeminiKey() !== null;
}

/**
 * Save a key. All whitespace is stripped, not just trimmed — keys pasted
 * from a page often pick up stray spaces or line breaks, and a real API key
 * never contains whitespace.
 */
export function saveGeminiKey(key: string): void {
  localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, key.replace(/\s+/g, ''));
}

export function clearGeminiKey(): void {
  try {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

/**
 * Ask Gemini for a typesetting suggestion.
 * `prompt` is the user's request; `context` is a short summary of the current
 * document/settings so the model can answer concretely.
 * Returns the raw reply text — callers parse it (see AiChatPanel) and must
 * never apply a proposed change without the user's approval.
 * Throws GeminiKeyMissingError when no key is configured and
 * GeminiRequestError (with a classified `kind` + `detail`) on API failure
 * or an empty reply.
 */
export async function askGemini(prompt: string, context?: string): Promise<string> {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new GeminiKeyMissingError();
  }
  const ai = new GoogleGenAI({ apiKey });
  const contents = context ? `${context}\n\nUser request:\n${prompt}` : prompt;
  try {
    return await generateWithModel(ai, contents, GEMINI_MODEL);
  } catch (err) {
    // v0.3.4 — if the primary model is not available for this key (e.g.
    // Google retired it for new users, as happened to gemini-2.5-flash),
    // retry once with the fallback model instead of failing outright.
    if (
      err instanceof GeminiRequestError &&
      err.kind === 'model_not_found' &&
      GEMINI_FALLBACK_MODEL !== GEMINI_MODEL
    ) {
      return generateWithModel(ai, contents, GEMINI_FALLBACK_MODEL);
    }
    throw err;
  }
}

/** One generateContent call against a single model, with classification. */
async function generateWithModel(
  ai: GoogleGenAI,
  contents: string,
  model: string,
): Promise<string> {
  let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    response = await ai.models.generateContent({ model, contents });
  } catch (err) {
    const info = describeGeminiError(err);
    throw new GeminiRequestError(info.kind, info.detail, err);
  }
  const text = response.text?.trim();
  if (!text) {
    throw new GeminiRequestError('empty_response');
  }
  return text;
}

/**
 * Test whether the saved key actually works: one tiny request. Resolves
 * with Gemini's reply (the word OK) when the key works; throws the same
 * classified GeminiRequestError / GeminiKeyMissingError as askGemini when
 * it does not, so the caller can show the specific reason.
 * The key is only ever sent to Google's Gemini API, never anywhere else.
 */
export async function testGeminiKey(): Promise<string> {
  return askGemini('Reply with only the word OK and nothing else.');
}
