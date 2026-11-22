/**
 * Keter Optional Nikud & Taamim Processing Engine
 * Principle: Nikud is NEVER automatically added by default.
 * Provides optional user-controlled operations:
 * - Preserve existing Nikud (default)
 * - Remove all Nikud
 * - Remove Biblical Taamim only
 * - Apply classical Rabbinic/Talmudic Nikud dictionary
 * - Edit/replace Nikud on individual words or units
 */

import { ContentUnit } from '../types/typesetter';

const RABBINIC_NIKUD_LEXICON: Record<string, string> = {
  'מאימתי': 'מֵאֵימָתַי',
  'קורין': 'קוֹרִין',
  'את': 'אֶת',
  'שמע': 'שְׁמַע',
  'בערבית': 'בְּעַרְבִית',
  'משעה': 'מִשָּׁעָה',
  'שהכהנים': 'שֶׁהַכֹּהֲנִים',
  'נכנסים': 'נִכְנָסִים',
  'לאכול': 'לֶאֱכֹל',
  'בתרומתן': 'בִּתְרוּמָתָן',
  'עד': 'עַד',
  'סוף': 'סוֹף',
  'האשמורה': 'הָאַשְׁמוּרָה',
  'הראשונה': 'הָרִאשׁוֹנָה',
  'דברי': 'דִּבְרֵי',
  'רבי': 'רַבִּי',
  'אליעזר': 'אֱלִיעֶזֶר',
  'וחכמים': 'וַחֲכָמִים',
  'אומרים': 'אוֹמְרִים',
  'חצות': 'חֲצוֹת',
  'רבן': 'רַבָּן',
  'גמליאל': 'גַּמְלִיאֵל',
  'אומר': 'אוֹמֵר',
  'שיעלה': 'שֶׁיַּעֲלֶה',
  'עמוד': 'עַמּוּד',
  'השחר': 'הַשַּׁחַר',
  'תנא': 'תָּנָא',
  'היכא': 'הֵיכָא',
  'קאי': 'קָאֵי',
  'דקתני': 'דְּקָתָנֵי',
  'גמרא': 'גְּמָרָא',
  'מתניתין': 'מַתְנִיתִין',
  'בראשית': 'בְּרֵאשִׁית',
  'ברא': 'בָּרָא',
  'אלהים': 'אֱלֹהִים',
  'השמים': 'הַשָּׁמַיִם',
  'הארץ': 'הָאָרֶץ',
};

export class NikudEngine {
  /**
   * Removes all Hebrew Nikud vowel marks while preserving letters and punctuation
   */
  public static removeNikud(text: string): string {
    return text.replace(/[\u05B0-\u05BC\u05C1\u05C2\u05C4\u05C5\u05C7]/g, '');
  }

  /**
   * Removes Biblical Cantillation marks (Taamim U+0591..U+05AF) while keeping Nikud
   */
  public static removeTaamim(text: string): string {
    return text.replace(/[\u0591-\u05AF]/g, '');
  }

  /**
   * Removes both Nikud and Taamim
   */
  public static stripAllDiacritics(text: string): string {
    return text.replace(/[\u0591-\u05C7]/g, '');
  }

  /**
   * Optional user-triggered automatic Nikud for unvocalized Hebrew words
   */
  public static applyAutomaticNikud(text: string): string {
    return text
      .split(/(\s+)/)
      .map(token => {
        if (/^\s+$/.test(token)) return token;
        // Separate leading/trailing punctuation
        const match = token.match(/^([^\u05D0-\u05EA]*)([\u05D0-\u05EA\u0591-\u05C7]+)([^\u05D0-\u05EA]*)$/);
        if (!match) return token;
        const [, prefix, core, suffix] = match;
        const cleanCore = this.stripAllDiacritics(core);
        const vocalized = RABBINIC_NIKUD_LEXICON[cleanCore];
        if (vocalized) {
          return `${prefix}${vocalized}${suffix}`;
        }
        return token;
      })
      .join('');
  }

  /**
   * Batch process units with the selected Nikud operation
   */
  public static processUnits(
    units: ContentUnit[],
    mode: 'preserve' | 'remove_nikud' | 'remove_taamim' | 'auto_nikud',
    targetRole?: 'all' | 'main_source' | 'commentary'
  ): ContentUnit[] {
    if (mode === 'preserve') return units;

    return units.map(u => {
      const isSource = u.role === 'main_source' || u.role === 'verse' || u.role === 'chapter';
      const isComment = u.role === 'primary_comment' || u.role === 'secondary_comment';

      if (targetRole === 'main_source' && !isSource) return u;
      if (targetRole === 'commentary' && !isComment) return u;

      let updatedText = u.rawText;
      if (mode === 'remove_nikud') {
        updatedText = this.removeNikud(u.rawText);
      } else if (mode === 'remove_taamim') {
        updatedText = this.removeTaamim(u.rawText);
      } else if (mode === 'auto_nikud') {
        updatedText = this.applyAutomaticNikud(u.rawText);
      }

      return {
        ...u,
        rawText: updatedText,
      };
    });
  }
}
