import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  X,
  Sliders,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Plus,
  Trash2,
  Lock,
  Layers,
  BookOpen,
} from 'lucide-react';
import {
  LocalRuleOverride,
  ProfessionalRuleSet,
  TypesettingRuleCategory,
  TypesettingRuleId,
  TypesettingRulesConfig,
  TypesettingRulesEngine,
  UserTypesettingRule,
} from '../engine/typesetting-rules-engine';
import {
  ENGINE_HARD_RULES,
  EngineHardRulesEngine,
} from '../engine/engine-hard-rules';

interface TypesettingRulesModalProps {
  rulesConfig: TypesettingRulesConfig;
  projectRules: UserTypesettingRule[];
  localOverrides: LocalRuleOverride[];
  onUpdateGlobalUserRules: (rules: UserTypesettingRule[]) => void;
  onUpdateProjectRules: (rules: UserTypesettingRule[]) => void;
  onUpdateLocalOverrides: (overrides: LocalRuleOverride[]) => void;
  onResetGlobalDefaults: () => void;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<TypesettingRuleCategory, string> = {
  paragraph: 'פסקאות, יתומים ואלמנות (Paragraphs)',
  headings: 'כותרות ופרקים (Headings)',
  semantic_content: 'קישורים סמנטיים ודיבור המתחיל (Semantic)',
  page_balance: 'איזון עמודים ו-Look-Ahead (Page Balance)',
  line_quality: 'איכות שורה ויישור (Line Quality)',
  hebrew_rtl: 'עברית, ניקוד וטעמים (Hebrew / RTL)',
  footnotes: 'הערות שוליים (Footnotes)',
  rav_text: 'רב-טקסט וברכיים (Rav Text)',
  ornaments: 'מדיניות עיטורים — משתמש בלבד (Stage 11D Ornaments)',
};

export const TypesettingRulesModal: React.FC<TypesettingRulesModalProps> = ({
  rulesConfig,
  projectRules,
  localOverrides,
  onUpdateGlobalUserRules,
  onUpdateProjectRules,
  onUpdateLocalOverrides,
  onResetGlobalDefaults,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] = useState<TypesettingRuleCategory>('paragraph');
  const [nlInstruction, setNlInstruction] = useState<string>('');
  const [nlTargetLayer, setNlTargetLayer] = useState<'user' | 'project'>('project');
  const [nlFeedback, setNlFeedback] = useState<string | null>(null);

  const profDefaults: ProfessionalRuleSet = useMemo(
    () => TypesettingRulesEngine.getProfessionalDefaults(),
    []
  );

  const allRuleIdsByCategory: Record<TypesettingRuleCategory, Array<{ ruleId: TypesettingRuleId; label: string; type: 'boolean' | 'number' }>> = {
    paragraph: [
      { ruleId: 'paragraph.preventWidows', label: 'מניעת שורת סיום יתומה בראש עמוד (Prevent Widows)', type: 'boolean' },
      { ruleId: 'paragraph.preventOrphans', label: 'מניעת שורת פתיחה בודדת בתחתית עמוד (Prevent Orphans)', type: 'boolean' },
      { ruleId: 'paragraph.minWidowLines', label: 'מינימום שורות סיום פסקה בעמוד הבא (Min Widow Lines)', type: 'number' },
      { ruleId: 'paragraph.minOrphanLines', label: 'מינימום שורות פתיחת פסקה בתחתית עמוד (Min Orphan Lines)', type: 'number' },
      { ruleId: 'paragraph.minFinalLineWords', label: 'מינימום מילים בשורה אחרונה של פסקה (Min Final Line Words)', type: 'number' },
      { ruleId: 'paragraph.allowContinuationAcrossPages', label: 'אפשר המשך פסקה ארוכה בין עמודים', type: 'boolean' },
    ],
    headings: [
      { ruleId: 'headings.keepWithNext', label: 'הצמד כותרת לפסקת הפתיחה שאחריה (Keep With Next)', type: 'boolean' },
      { ruleId: 'headings.minFollowingLines', label: 'מינימום שורות טקסט אחרי כותרת באותו עמוד', type: 'number' },
      { ruleId: 'headings.preventStrandedAtBottom', label: 'איסור כותרת בודדת בתחתית עמוד או טור', type: 'boolean' },
      { ruleId: 'headings.isolateFromBodyLine', label: 'הפרדת שורת כותרת משורת גוף הטקסט (C-1)', type: 'boolean' },
      { ruleId: 'headings.neverJustifyHeading', label: 'לעולם אל תיישר כותרת כבלוק רגיל (Never Justify Heading)', type: 'boolean' },
    ],
    semantic_content: [
      { ruleId: 'semantic.sourceCommentaryPriority', label: 'עדיפות הצמדת מקור ופירוש באותו עמוד (Priority 100)', type: 'number' },
      { ruleId: 'semantic.dibburCommentaryPriority', label: 'עדיפות הצמדת דיבור המתחיל לפירוש (Priority 90)', type: 'number' },
      { ruleId: 'semantic.minBodyWordsAfterDibburOnPage', label: 'מינימום מילות הסבר אחרי דיבור המתחיל לפני מעבר עמוד', type: 'number' },
      { ruleId: 'semantic.keepVerseWithCommentary', label: 'הצמד פסוק לפירושו במקראות גדולות', type: 'boolean' },
      { ruleId: 'semantic.keepFootnoteWithAnchor', label: 'הצמד הערת שוליים לעמוד העוגן שלה', type: 'boolean' },
    ],
    page_balance: [
      { ruleId: 'pageBalance.avoidExcessiveEmptySpace', label: 'מנע חלל ריק מופרז בעמוד (Avoid Excessive Empty Space)', type: 'boolean' },
      { ruleId: 'pageBalance.minSparseNextPageWords', label: 'מינימום מילים בעמוד המשך (מניעת עמוד שני דליל)', type: 'number' },
      { ruleId: 'pageBalance.maxCommentaryWidowTailWords', label: 'סף מילים לזנב פירוש קצר שיועבר לעמוד הבא', type: 'number' },
      { ruleId: 'pageBalance.avoidUnnecessaryPageBreaks', label: 'מנע מעברי עמוד מיותרים', type: 'boolean' },
    ],
    line_quality: [
      { ruleId: 'lineQuality.minReadableSourceWidthPt', label: 'רוחב מינימלי קריא לטקסט מקור (pt)', type: 'number' },
      { ruleId: 'lineQuality.minReadableCommentaryWidthPt', label: 'רוחב מינימלי קריא לטור פירוש (pt)', type: 'number' },
      { ruleId: 'lineQuality.avoidOneWordMidParagraphLines', label: 'מנע שורות בנות מילה אחת באמצע פסקה', type: 'boolean' },
      { ruleId: 'lineQuality.preserveNaturalRaggedFinalLines', label: 'שמור על שורה אחרונה קצרה טבעית ללא מתיחה', type: 'boolean' },
      { ruleId: 'lineQuality.minLinesForSourceWidthExpansion', label: 'מינימום שורות לשינוי רוחב מדרגה במקור (H-2)', type: 'number' },
    ],
    hebrew_rtl: [
      { ruleId: 'hebrewRtl.preserveRtlMonotonicOrder', label: 'שמירה קשיחה על סדר מילים מימין לשמאל (RTL)', type: 'boolean' },
      { ruleId: 'hebrewRtl.preserveCombiningMarksZeroAdvance', label: 'רוחב קידום אפס לניקוד וטעמים (Zero-Advance Marks)', type: 'boolean' },
      { ruleId: 'hebrewRtl.preventOrphanedDiacritics', label: 'מניעת סימני ניקוד או טעמים יתומים ללא אות בסיס', type: 'boolean' },
    ],
    footnotes: [
      { ruleId: 'footnotes.preserveAnchorRelationship', label: 'שמירת קשר עוגן מדויק בין המילה בגוף הטקסט להערה', type: 'boolean' },
      { ruleId: 'footnotes.samePageWithAnchor', label: 'הצגת הערת שוליים באותו עמוד שבו מופיע העוגן', type: 'boolean' },
      { ruleId: 'footnotes.allowMultiPageContinuation', label: 'אפשר פיצול הערת שוליים ארוכה במיוחד לעמוד הבא', type: 'boolean' },
      { ruleId: 'footnotes.justifyMultiLineNonFinal', label: 'יישור דו-צדדי להערות שוליים מרובות שורות (B-4)', type: 'boolean' },
    ],
    rav_text: [
      { ruleId: 'ravText.preferSamePageSourceCommentary', label: 'העדף השארת גמרא, רש״י ותוספות מקושרים באותו עמוד', type: 'boolean' },
      { ruleId: 'ravText.dibburKeepTogether', label: 'איסור שבירת דיבור המתחיל בתחתית עמוד ללא גוף הפירוש', type: 'boolean' },
      { ruleId: 'ravText.defaultUpperCollarLines', label: 'מספר שורות ברירת מחדל בכתף העליונה (Upper Collar)', type: 'number' },
      { ruleId: 'ravText.defaultGutterWidthPt', label: 'מרווח גטר ברירת מחדל בין מקור לפירוש (pt)', type: 'number' },
    ],
    ornaments: [
      { ruleId: 'ornaments.userSuppliedOnly', label: 'עיטורים מסופקים ע״י המשתמש בלבד — ללא המצאה אוטומטית (Stage 11D)', type: 'boolean' },
      { ruleId: 'ornaments.forbidAutoSelectionOfBuiltins', label: 'איסור בחירה אוטומטית של עיטורים מובנים מהספרייה', type: 'boolean' },
      { ruleId: 'ornaments.forbidAutoCreationOnEmptySpace', label: 'איסור הוספת עיטור אוטומטי בגלל שטח פנוי בעמוד', type: 'boolean' },
      { ruleId: 'ornaments.minSafetyClearancePt', label: 'מרווח בטיחות מינימלי בין עיטור משתמש לטקסט (pt)', type: 'number' },
    ],
  };

  const handleParseNaturalLanguage = () => {
    if (!nlInstruction.trim()) return;
    const parsed = TypesettingRulesEngine.parseNaturalLanguageInstruction(nlInstruction, {
      targetLayer: nlTargetLayer,
      makeHardConstraint: true,
    });
    if (parsed.length === 0) {
      setNlFeedback('לא זוהה כלל מובנה בהוראה זו. נסה למשל: "לעולם אל תשאיר כותרת עם פחות מ-3 שורות המשך"');
      return;
    }

    if (nlTargetLayer === 'project') {
      const next = [...projectRules];
      for (const r of parsed) {
        const idx = next.findIndex(existing => existing.ruleId === r.ruleId);
        if (idx >= 0) next[idx] = r;
        else next.push(r);
      }
      onUpdateProjectRules(next);
    } else {
      const next = [...rulesConfig.userRules.rules];
      for (const r of parsed) {
        const idx = next.findIndex(existing => existing.ruleId === r.ruleId);
        if (idx >= 0) next[idx] = r;
        else next.push(r);
      }
      onUpdateGlobalUserRules(next);
    }

    setNlInstruction('');
    setNlFeedback(
      `תורגם בהצלחה ל-${parsed.length} חוקים קשיחים (${parsed.map(p => p.ruleId).join(', ')})!`
    );
    setTimeout(() => setNlFeedback(null), 5000);
  };

  const handleSetProjectRule = (
    ruleId: TypesettingRuleId,
    category: TypesettingRuleCategory,
    value: boolean | number,
    isHard: boolean
  ) => {
    const newRule: UserTypesettingRule = {
      id: `proj-rule-${ruleId}`,
      ruleId,
      category,
      enabled: true,
      priority: isHard ? 'HARD_USER_RULE' : 'AI_PREFERENCE',
      isHardConstraint: isHard,
      value,
      source: 'project',
      description: `הגדרת פרויקט עבור ${ruleId}`,
    };
    const next = [...projectRules.filter(r => r.ruleId !== ruleId), newRule];
    onUpdateProjectRules(next);
  };

  const handleRemoveProjectRule = (ruleId: TypesettingRuleId) => {
    onUpdateProjectRules(projectRules.filter(r => r.ruleId !== ruleId));
  };

  const handleRemoveLocalOverride = (id: string) => {
    onUpdateLocalOverrides(localOverrides.filter(o => o.id !== id));
  };

  void profDefaults;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none" dir="rtl">
      <div className="bg-stone-900 border border-stone-700 w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden flex flex-col text-stone-200 max-h-[90vh]">
        {/* Header */}
        <div className="h-14 bg-stone-950 border-b border-stone-800 flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950 border border-amber-700/70 flex items-center justify-center text-amber-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-stone-100">
                מנוע חוקי עימוד מקצועיים (Stage 12 — Professional Typesetting Rules Engine)
              </h2>
              <p className="text-[11px] text-stone-400">
                היררכיית סמכות: Level 0 Engine Hard Rules ← Level 1 Local/Project/User Hard Rules ← Level 2 Professional Defaults ← Level 3 AI Preferences
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Natural Language Rule Translation Bar */}
        <div className="bg-stone-950/80 border-b border-stone-800 px-5 py-3 space-y-2">
          <div className="flex items-center gap-2 text-xs text-amber-300 font-medium">
            <Sparkles className="w-3.5 h-3.5" />
            <span>תרגום הוראת עימוד בשפה טבעית לחוק מובנה וקשיח (Hard Rule):</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nlInstruction}
              onChange={e => setNlInstruction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleParseNaturalLanguage()}
              placeholder='למשל: "לעולם אל תשאיר כותרת עם פחות מ-3 שורות המשך" או "אל תוסיף עיטורים אוטומטית"'
              className="flex-1 bg-stone-900 border border-stone-700 rounded-md px-3 py-1.5 text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-amber-500"
            />
            <select
              value={nlTargetLayer}
              onChange={e => setNlTargetLayer(e.target.value as 'user' | 'project')}
              className="bg-stone-900 border border-stone-700 rounded-md px-2.5 py-1.5 text-xs text-stone-200"
            >
              <option value="project">חוק לפרויקט הנוכחי</option>
              <option value="user">חוק משתמש גלובלי</option>
            </select>
            <button
              onClick={handleParseNaturalLanguage}
              className="px-3.5 py-1.5 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>הוסף חוק</span>
            </button>
          </div>
          {nlFeedback && (
            <div className="text-[11px] text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{nlFeedback}</span>
            </div>
          )}
        </div>

        {/* Main Body: Category Sidebar + Rules List */}
        <div className="flex-1 flex overflow-hidden">
          {/* Categories Sidebar */}
          <div className="w-64 bg-stone-950/60 border-l border-stone-800 p-3 space-y-1 overflow-y-auto">
            {(Object.keys(CATEGORY_LABELS) as TypesettingRuleCategory[]).map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`w-full text-right px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                  activeCategory === cat
                    ? 'bg-amber-600/20 text-amber-300 border border-amber-600/40 font-semibold'
                    : 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-200'
                }`}
              >
                <span className="truncate">{CATEGORY_LABELS[cat]}</span>
              </button>
            ))}

            <div className="pt-3 mt-3 border-t border-stone-800">
              <button
                onClick={onResetGlobalDefaults}
                className="w-full px-3 py-2 rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-300 border border-stone-700 text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                <span>איפוס לברירות מחדל מקצועיות</span>
              </button>
            </div>
          </div>

          {/* Rules Editor Area */}
          <div className="flex-1 p-5 overflow-y-auto space-y-3">
            <div className="flex items-center justify-between border-b border-stone-800 pb-2.5">
              <h3 className="text-xs font-bold text-amber-400 flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                <span>{CATEGORY_LABELS[activeCategory]}</span>
              </h3>
              <span className="text-[11px] text-stone-400">
                שינוי ערך יוצר חוק פרויקט (Project Rule) שנשמר אוטומטית ותומך ב-Undo/Redo
              </span>
            </div>

            <div className="space-y-2.5">
              {allRuleIdsByCategory[activeCategory].map(item => {
                const resolved = TypesettingRulesEngine.resolveRule(
                  item.ruleId,
                  {},
                  rulesConfig
                );
                const projRule = projectRules.find(r => r.ruleId === item.ruleId);
                const engineHardRule = EngineHardRulesEngine.getMappedEngineHardRule(item.ruleId);
                const isBooleanEngineLocked =
                  Boolean(engineHardRule) && item.type === 'boolean';

                return (
                  <div
                    key={item.ruleId}
                    className={`p-3.5 rounded-lg border flex items-center justify-between gap-4 ${
                      engineHardRule
                        ? 'bg-emerald-950/20 border-emerald-800/60'
                        : 'bg-stone-950/70 border-stone-800'
                    }`}
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-stone-100">
                          {item.label}
                        </span>
                        {engineHardRule ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            <span>LEVEL 0 ENGINE HARD RULE (IMMUTABLE)</span>
                          </span>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                              resolved.isHardConstraint
                                ? 'bg-amber-950/90 text-amber-300 border border-amber-700/60'
                                : 'bg-stone-800 text-stone-300'
                            }`}
                          >
                            {resolved.sourceLayer} • {resolved.isHardConstraint ? 'HARD RULE' : 'PREFERENCE'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-400 font-mono flex items-center gap-2 flex-wrap">
                        <span>Rule ID: {item.ruleId}</span>
                        <span>•</span>
                        <span>Authority: Level {resolved.authorityLevel}</span>
                        {engineHardRule && typeof engineHardRule.minimumThreshold === 'number' && (
                          <>
                            <span>•</span>
                            <span className="text-emerald-400">
                              Engine Floor: ≥ {engineHardRule.minimumThreshold}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      {item.type === 'boolean' ? (
                        <button
                          disabled={isBooleanEngineLocked}
                          onClick={() => {
                            if (isBooleanEngineLocked) return;
                            handleSetProjectRule(
                              item.ruleId,
                              activeCategory,
                              !Boolean(resolved.value),
                              true
                            );
                          }}
                          title={
                            isBooleanEngineLocked
                              ? 'חוק מנוע קשיח (Level 0 Engine Hard Rule) — נעול בקוד המערכת ואינו ניתן לכיבוי'
                              : undefined
                          }
                          className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                            isBooleanEngineLocked
                              ? 'bg-emerald-900/70 text-emerald-200 border border-emerald-700/60 cursor-not-allowed'
                              : Boolean(resolved.value)
                              ? 'bg-emerald-700 text-white'
                              : 'bg-stone-800 text-stone-400'
                          }`}
                        >
                          {isBooleanEngineLocked ? 'נעול מנוע (כן)' : Boolean(resolved.value) ? 'פעיל (כן)' : 'כבוי (לא)'}
                        </button>
                      ) : (
                        <input
                          type="number"
                          min={engineHardRule?.minimumThreshold}
                          value={Number(resolved.value)}
                          onChange={e => {
                            const rawVal = Number(e.target.value);
                            const safeVal =
                              engineHardRule && typeof engineHardRule.minimumThreshold === 'number'
                                ? Math.max(engineHardRule.minimumThreshold, rawVal)
                                : rawVal;
                            handleSetProjectRule(
                              item.ruleId,
                              activeCategory,
                              safeVal,
                              true
                            );
                          }}
                          className="w-20 bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-center text-amber-300 font-mono"
                        />
                      )}

                      {projRule && !isBooleanEngineLocked && (
                        <button
                          onClick={() => handleRemoveProjectRule(item.ruleId)}
                          title="הסר דריסת פרויקט וחזור לברירת המחדל המקצועית"
                          className="p-1.5 rounded bg-stone-900 hover:bg-rose-950 text-stone-400 hover:text-rose-300 border border-stone-800"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Level 0 Owner / Engine Hard Rules Read-Only Summary */}
            <div className="mt-6 pt-4 border-t border-stone-800 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    חוקי ברזל של מנוע כתר (Level 0 — Owner / Engine Hard Rules: {ENGINE_HARD_RULES.length} חוקים נעולים בקוד)
                  </span>
                </h4>
                <span className="text-[10px] text-stone-400 font-mono">
                  src/engine/engine-hard-rules.ts • userEditable=false
                </span>
              </div>
              <p className="text-[11px] text-stone-400">
                חוקי Level 0 מגינים על שימור 100% מהטקסט, אפס התנגשויות גיאומטריות, סדר RTL וניקוד תקין, שלמות קישורי רב-טקסט והערות שוליים, ומדיניות עיטורים מסופקי-משתמש בלבד. חוקים אלו אינם ניתנים לעקיפה ע״י AI, משתמש, פרויקט או דריסה מקומית.
              </p>
            </div>

            {/* Active Local Overrides Section */}
            {localOverrides.length > 0 && (
              <div className="mt-6 pt-4 border-t border-stone-800 space-y-2">
                <h4 className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" />
                  <span>דריסות מקומיות פעילות (Local Overrides — עדיפות עליונה):</span>
                </h4>
                {localOverrides.map(ov => (
                  <div
                    key={ov.id}
                    className="p-2.5 rounded bg-purple-950/30 border border-purple-800/50 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-mono text-purple-200">{ov.ruleId}</span>
                      <span className="mx-2 text-stone-500">•</span>
                      <span className="text-stone-300">
                        ערך: {String(ov.value)} (Scope: {JSON.stringify(ov.scope)})
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveLocalOverride(ov.id)}
                      className="text-rose-400 hover:text-rose-300 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-stone-950 border-t border-stone-800 px-5 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-stone-400">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              כללי משתמש ופרויקט נשמרים אוטומטית ב-LocalStorage ובקובץ הפרויקט (.keter.json)
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs"
          >
            סגור ושמור
          </button>
        </div>
      </div>
    </div>
  );
};
