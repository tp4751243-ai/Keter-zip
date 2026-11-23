/**
 * Keter Font Capability Analyzer & Holy-Book Compatibility Matrix
 * Evaluates Hebrew Unicode range, Nikud combining marks, Biblical Taamim,
 * OpenType GPOS mark/mkmk features, and Holy-Book typesetting suitability.
 */

import { FontCapability } from '../types/typesetter';

export const KNOWN_HOLY_BOOK_FONTS: FontCapability[] = [
  {
    family: 'Noto Serif Hebrew',
    postScriptName: 'NotoSerifHebrew-Regular',
    hasHebrew: true,
    hasNikud: true,
    // Measured: all 31 cantillation marks, nikkud and meteg. Bundled
    // (public/fonts, OFL) as the whole-word teamim font.
    hasTaamim: true,
    hasGposMark: true,
    hasGposMkmk: true,
    hasGsubLigature: true,
    suitabilityScore: 95,
    notes: 'Serif with full nikkud AND teamim; Keter sets every word that carries cantillation in it when the body font has none.',
    recommendedRole: 'main_source',
  },
  {
    family: 'David Libre',
    postScriptName: 'DavidLibre-Regular',
    hasHebrew: true,
    hasNikud: true,
    // Measured: no cantillation marks and no meteg.
    hasTaamim: false,
    hasGposMark: true,
    hasGposMkmk: false,
    hasGsubLigature: true,
    suitabilityScore: 85,
    notes: 'Classic David design with nikkud; no teamim and no meteg (such words switch whole to Noto Serif Hebrew).',
    recommendedRole: 'main_source',
  },
  {
    family: 'Frank Ruhl Libre',
    postScriptName: 'FrankRuhlLibre-Regular',
    hasHebrew: true,
    hasNikud: true,
    // Measured (layout training T3.6, cmap of public/fonts/FrankRuhlLibre-
    // Regular.ttf): 0 of the 31 cantillation marks U+0591–U+05AF; nikkud
    // and meteg present. Words with teamim are set in TEAMIM_FALLBACK_FONT.
    hasTaamim: false,
    hasGposMark: true,
    hasGposMkmk: true,
    hasGsubLigature: true,
    suitabilityScore: 98,
    notes: 'Premier traditional Jewish holy-book serif typeface. Full nikkud and meteg; no cantillation marks (teamim words switch whole to Noto Serif Hebrew).',
    recommendedRole: 'main_source',
  },
  {
    family: 'Taamey Frank CLM',
    postScriptName: 'TaameyFrankCLM-Medium',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: true,
    hasGposMark: true,
    hasGposMkmk: true,
    hasGsubLigature: true,
    suitabilityScore: 100,
    notes: 'Gold standard for Chumash / Tanach with exhaustive Biblical Taamim (cantillation marks).',
    recommendedRole: 'main_source',
  },
  {
    family: 'Noto Rashi Hebrew',
    postScriptName: 'NotoRashiHebrew-Regular',
    hasHebrew: true,
    hasNikud: true,
    // Measured: all 31 cantillation marks present.
    hasTaamim: true,
    hasGposMark: true,
    hasGposMkmk: true,
    hasGsubLigature: true,
    suitabilityScore: 99,
    notes: 'Google Fonts OpenType Rashi Script font specifically engineered for religious holy commentaries with full vowel Nikud.',
    recommendedRole: 'rashi',
  },
  {
    family: 'Guttman Vilna',
    postScriptName: 'GuttmanVilna',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: false,
    hasGposMark: true,
    hasGposMkmk: false,
    hasGsubLigature: true,
    suitabilityScore: 95,
    notes: 'Classic Windows installed holy-book font. Traditional Vilna Shas letterforms.',
    recommendedRole: 'main_source',
  },
  {
    family: 'Guttman Rashi',
    postScriptName: 'GuttmanRashi',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: false,
    hasGposMark: true,
    hasGposMkmk: false,
    hasGsubLigature: true,
    suitabilityScore: 95,
    notes: 'Traditional Windows installed Rashi script font used across Israeli holy-book publishers.',
    recommendedRole: 'rashi',
  },
  {
    family: 'Guttman Keter',
    postScriptName: 'GuttmanKeter',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: true,
    hasGposMark: true,
    hasGposMkmk: true,
    hasGsubLigature: true,
    suitabilityScore: 94,
    notes: 'Crown typeface inspired by the Aleppo Codex (Keter Aram Tzova).',
    recommendedRole: 'main_source',
  },
  {
    family: 'David Libre',
    postScriptName: 'DavidLibre-Regular',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: false,
    hasGposMark: true,
    hasGposMkmk: false,
    hasGsubLigature: true,
    suitabilityScore: 82,
    notes: 'Crisp, highly legible book serif. Excellent for modern holy commentaries, Halacha, and Responsa.',
    recommendedRole: 'general',
  },
  {
    family: 'Noto Serif Hebrew',
    postScriptName: 'NotoSerifHebrew-Regular',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: true,
    hasGposMark: true,
    hasGposMkmk: true,
    hasGsubLigature: true,
    suitabilityScore: 94,
    notes: 'Comprehensive Unicode coverage with harmonious proportion across all mark combinations.',
    recommendedRole: 'tosafot',
  },
  {
    family: 'Vilna Classic / Keter Shas',
    postScriptName: 'Vilna-Regular',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: false,
    hasGposMark: true,
    hasGposMkmk: false,
    hasGsubLigature: true,
    suitabilityScore: 90,
    notes: 'Authentic Vilna Shas Gemara headline and commentary typeface.',
    recommendedRole: 'main_source',
  },
  {
    family: 'Rashi Script CLM',
    postScriptName: 'RashiCLM-Regular',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: false,
    hasGposMark: true,
    hasGposMkmk: false,
    hasGsubLigature: true,
    suitabilityScore: 95,
    notes: 'Semi-cursive Sephardic typeface universally used for Rashi and Tosafot commentaries.',
    recommendedRole: 'rashi',
  },
  {
    family: 'Arial Hebrew',
    postScriptName: 'ArialHebrew',
    hasHebrew: true,
    hasNikud: true,
    hasTaamim: false,
    hasGposMark: false,
    hasGposMkmk: false,
    hasGsubLigature: false,
    suitabilityScore: 50,
    notes: 'System sans-serif. Lacks OpenType anchor positioning for complex biblical vocalization.',
    recommendedRole: 'general',
  },
  {
    family: 'Times New Roman',
    postScriptName: 'TimesNewRomanPSMT',
    hasHebrew: true,
    hasNikud: false,
    hasTaamim: false,
    hasGposMark: false,
    hasGposMkmk: false,
    hasGsubLigature: false,
    suitabilityScore: 35,
    notes: 'Consonantal Hebrew only. Severe Nikud overlap and collision hazards.',
    recommendedRole: 'general',
  },
];

export class FontAnalyzer {
  /**
   * Scans font capabilities and returns analysis
   */
  public static getRecommendedFont(role: 'main_source' | 'rashi' | 'tosafot' | 'general'): FontCapability {
    const match = KNOWN_HOLY_BOOK_FONTS.find(f => f.recommendedRole === role && f.suitabilityScore >= 90);
    return match || KNOWN_HOLY_BOOK_FONTS[0];
  }

  public static auditAll(): FontCapability[] {
    return KNOWN_HOLY_BOOK_FONTS;
  }

  public static getAvailableSystemFonts() {
    // v0.5.0 Part A — Module 1: restore persisted imported fonts in the
    // background (IndexedDB). Dynamic import avoids a static cycle:
    // font-library.ts imports this module. Fire-and-forget; the font
    // dropdown and Font Manager subscribe to the library for updates.
    void import('./font-library')
      .then(m => m.initFontLibrary())
      .catch(() => undefined);
    const hebrewNames: Record<string, string> = {
      'Frank Ruhl Libre': 'פרנק-ריהל ליברה (Frank Ruhl Libre)',
      'Taamey Frank CLM': 'טעמי פרנק (Taamey Frank CLM)',
      'Noto Rashi Hebrew': 'נוטו רש״י (Noto Rashi Hebrew)',
      'Guttman Vilna': 'גוטמן וילנא (Guttman Vilna)',
      'Guttman Rashi': 'גוטמן רש״י (Guttman Rashi)',
      'Guttman Keter': 'גוטמן כתר (Guttman Keter)',
      'David Libre': 'דוד ליברה (David Libre)',
      'Noto Serif Hebrew': 'נוטו סריף עברית (Noto Serif Hebrew)',
      'Vilna Classic / Keter Shas': 'וילנא קלאסי / כתר ש״ס',
      'Rashi Script CLM': 'כתב רש״י CLM',
      'Arial Hebrew': 'אריאל עברית (Arial Hebrew)',
      'Times New Roman': 'Times New Roman',
      'Miriam Libre': 'מרים ליברה (Miriam Libre)',
    };
    const list = KNOWN_HOLY_BOOK_FONTS.map(f => ({
      family: f.family,
      displayNameHe: hebrewNames[f.family] || f.family,
      postScriptName: f.postScriptName,
      suitabilityScore: f.suitabilityScore,
      hasHebrew: f.hasHebrew,
      hasNikud: f.hasNikud,
      hasTaamim: f.hasTaamim,
      hasGposMark: f.hasGposMark,
      hasGposMkmk: f.hasGposMkmk,
      recommendedRole: f.recommendedRole,
    }));
    if (!list.some(f => f.family === 'Miriam Libre')) {
      list.push({
        family: 'Miriam Libre',
        displayNameHe: 'מרים ליברה (Miriam Libre)',
        postScriptName: 'MiriamLibre-Regular',
        suitabilityScore: 88,
        hasHebrew: true,
        hasNikud: true,
        hasTaamim: false,
        hasGposMark: true,
        hasGposMkmk: false,
        recommendedRole: 'general',
      });
    }
    return list;
  }
}

export const FontAnalyzerEngine = FontAnalyzer;



/**
 * Layout training T3.6 (hebrew-book-typesetter rule): a word that carries
 * cantillation marks is set WHOLE in a font that has them — never patched
 * mark by mark from a fallback font, which duplicates letters inside the
 * word (בראשְשִׁית) and mixes typefaces mid-word.
 */
export const TEAMIM_FALLBACK_FONT = 'Noto Serif Hebrew';
const TEAMIM_RE = /[\u0591-\u05AF]/;

export function wordHasTeamim(word: string): boolean {
  return TEAMIM_RE.test(word);
}

/** True when the font is known to lack cantillation marks (unknown fonts are trusted). */
export function fontLacksTeamim(family: string | undefined): boolean {
  if (!family) return false;
  const f = KNOWN_HOLY_BOOK_FONTS.find(k => k.family.toLowerCase() === family.toLowerCase());
  return f ? !f.hasTaamim : false;
}
