import React, { useState } from 'react';
import { useEscapeToClose } from './useDialogEscape';
import { BookMarked, ShieldAlert, Cpu, CheckCircle2, AlertTriangle, Layers, X, FileCode } from 'lucide-react';

interface Milestone1ReportModalProps {
  onClose: () => void;
}

export const Milestone1ReportModal: React.FC<Milestone1ReportModalProps> = ({ onClose }) => {
  useEscapeToClose(onClose);
  const [activeTab, setActiveTab] = useState<'analysis' | 'risks' | 'decisions' | 'repo' | 'licenses' | 'status'>('analysis');

  return (
    <div className="keter-dialog-backdrop select-none" onClick={onClose}>
      <div className="keter-dialog-surface w-full max-w-4xl rounded-xl overflow-hidden flex flex-col text-[var(--ui-text-primary)] h-[88vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <BookMarked className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--ui-text-primary)]">
                ניתוח מפרט טכני, סיכונים ארכיטקטוניים ודוח שלב 1 (Milestone 1)
              </h2>
              <p className="text-[11px] text-[var(--ui-text-secondary)] font-mono">
                Keter Typesetter — Commercial Desktop Jewish Holy-Book Engine
              </p>
            </div>
          </div>
          <button onClick={onClose} title="סגור" className="p-1 hover:bg-[var(--ui-surface-hover)] rounded text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="h-11 bg-[var(--ui-surface-subtle)]/70 border-b border-[var(--ui-border)] flex items-center px-6 gap-2 text-xs overflow-x-auto">
          {[
            { id: 'analysis', label: '1. ניתוח המפרט (Spec Analysis)' },
            { id: 'risks', label: '2. סיכונים ארכיטקטוניים (Risks)' },
            { id: 'decisions', label: '3. החלטות חסרות (Missing Decisions)' },
            { id: 'repo', label: '4. מבנה ה-Repository' },
            { id: 'licenses', label: '5. תלויות ורישיונות (Licenses)' },
            { id: 'status', label: '6. סטטוס שלב 1 ומה נותר' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-amber-700/80 text-white shadow-sm'
                  : 'text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] hover:bg-[var(--ui-surface-hover)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 text-xs leading-relaxed space-y-4 text-[var(--ui-text-secondary)]">
          {activeTab === 'analysis' && (
            <div className="space-y-4">
              <div className="border-r-4 border-amber-500 pr-3">
                <h3 className="text-sm font-bold text-[var(--ui-text-primary)] mb-1">ניתוח דרישות המערכת וייעודה המסחרי</h3>
                <p className="text-[var(--ui-text-secondary)]">
                  מטרת הפרויקט הינה פיתוח יישום שולחני Windows עצמאי (ללא תלות ב-Adobe InDesign לייצור ה-PDF והעימוד) לעימוד אוטומטי של ספרי קודש יהודיים מקבצי DOCX, תוך התמחות מוחלטת בטיפוגרפיה עברית, RTL, ניקוד מדויק, טעמי המקרא, עימוד רב-טקסט (גמרא, מקראות גדולות, רמב"ם) וברכיים דינמיות ("Berayim").
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="bg-[var(--ui-surface-subtle)] p-4 rounded-lg border border-[var(--ui-border)]">
                  <h4 className="font-semibold text-amber-400 mb-2">עקרונות בל יעברו במפרט</h4>
                  <ul className="list-disc list-inside space-y-1.5 text-[var(--ui-text-secondary)] text-[11px]">
                    <li><b>איסור מוחלט על SILE</b> כמנוע עימוד.</li>
                    <li>איסור על הערכת עימוד לפי ספירת מילים/תווים — מדידה על פי גליפים אמיתיים בלבד.</li>
                    <li>איסור על המצאת קשרים בין מקור לפירוש; איסור על העלמת שגיאות.</li>
                    <li>הפרדה מוחלטת בין מודל המסמך הלוגי (ID יציב) לבין קואורדינטות פיזיות בעמוד.</li>
                    <li>ייצוא חובה לקובצי <b>PDF</b> print-ready ולקובצי <b>IDML</b> הניתנים לעריכה מלאה ב-InDesign.</li>
                  </ul>
                </div>

                <div className="bg-[var(--ui-surface-subtle)] p-4 rounded-lg border border-[var(--ui-border)]">
                  <h4 className="font-semibold text-amber-400 mb-2">ארכיטקטורת שכבות עצמאית</h4>
                  <ul className="list-disc list-inside space-y-1.5 text-[var(--ui-text-secondary)] text-[11px]">
                    <li><b>C++20 Core Engine</b>: מנוע עימוד עצמאי, HarfBuzz, ICU, FreeType.</li>
                    <li><b>Qt 6 Windows UI</b>: תצוגת מקדימה עתירת ביצועים, ביטול סרגלי כלים מיותרים.</li>
                    <li><b>Document Model</b>: Source of truth מנותק מ-Word ומ-InDesign.</li>
                    <li><b>AI Typesetter Layer</b>: Gemini API / LLM עם מנגנון אישור שינויים (Approval Workflow).</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'risks' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[var(--ui-text-primary)]">סיכונים ארכיטקטוניים מרכזיים (Architectural Risks)</h3>
              
              <div className="space-y-3">
                <div className="p-3.5 bg-red-950/30 border border-red-800/60 rounded-lg">
                  <div className="flex items-center gap-2 text-red-400 font-semibold mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>סיכון 1: חישוב מתכנס של ברכיים דינמיות ("Berayim Convergence Loop")</span>
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)]">
                    <b>חומרה: קריטית.</b> שינוי רוחב עמודת המקור משפיע על מספר השורות שלה, מה שמשנה את גובה נקודת הצומת (Junction Y), שבתורה משנה את השטח שנותר לרש"י. אם המנוע לא ישתמש באלגוריתם מיתון (Relaxation / Fixed-Point Iteration עם תקרת איטרציות), הוא עלול להיכנס ללולאת תנודה אינסופית (Flip-Flop).
                  </p>
                </div>

                <div className="p-3.5 bg-amber-950/30 border border-amber-800/60 rounded-lg">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>סיכון 2: התנגשויות עוגני ניקוד וטעמים בגופנים ללא טבלאות GPOS mkmk</span>
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)]">
                    <b>חומרה: גבוהה.</b> גופנים שאינם כוללים טבלאות Mark-to-Base ו-Mark-to-Mark stacking גורמים לחפיפת ניקוד (פתח מתחת לחיריק, אתנחתא על גבי קמץ). המערכת חייבת מודול בדיקה וגילוי גופנים מקדים, עם התרעה למשתמש לפני תחילת עימוד.
                  </p>
                </div>

                <div className="p-3.5 bg-blue-950/30 border border-blue-800/60 rounded-lg">
                  <div className="flex items-center gap-2 text-blue-400 font-semibold mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span>סיכון 3: ייצוא IDML עם תיבות טקסט מרובות-מקטעים ללא שבירת קישורים</span>
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)]">
                    <b>חומרה: בינונית-גבוהה.</b> InDesign אינו תומך באופן טבעי במסגרת טקסט יחידה בעלת רוחב משתנה (מדרגה). על המנוע לייצר מספר תיבות טקסט משורשרות (Threaded Text Frames) עבור עמודת המקור התחתונה והעליונה.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'decisions' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[var(--ui-text-primary)]">החלטות טכניות חסרות שהוכרעו (Resolved Technical Decisions)</h3>
              
              <div className="space-y-2.5">
                <div className="p-3 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg">
                  <h4 className="font-semibold text-amber-300 text-xs mb-1">1. מערכת הקואורדינטות הפנימית</h4>
                  <p className="text-[11px] text-[var(--ui-text-secondary)]">
                    <b>הכרעה:</b> שימוש בנקודות טיפוגרפיות מדויקות (PostScript Points, 72 pt = 1 inch) כמספר ממשי (double) במנוע ה-C++, המומר ל-Twips (1/20 pt) בעת ייצוא ל-IDML.
                  </p>
                </div>

                <div className="p-3 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg">
                  <h4 className="font-semibold text-amber-300 text-xs mb-1">2. כללי יישור עברי (Hebrew Justification)</h4>
                  <p className="text-[11px] text-[var(--ui-text-secondary)]">
                    <b>הכרעה:</b> שילוב מבוקר של הרחבת רווחים בין-מילים (עד 35% תוספת מקסימום), עם הכנה למתיחת אותיות רפויות מסורתיות (ק, ל, ת, ד, ר) בשלב 5.
                  </p>
                </div>

                <div className="p-3 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg">
                  <h4 className="font-semibold text-amber-300 text-xs mb-1">3. גרסת יעד עבור InDesign IDML</h4>
                  <p className="text-[11px] text-[var(--ui-text-secondary)]">
                    <b>הכרעה:</b> יצירת חבילות IDML תואמות DOMVersion 18.0 / 19.0 (InDesign CC 2023-2024), הניתנות לפתיחה לאחור גם בגרסאות קודמות (CS6+).
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'repo' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[var(--ui-text-primary)]">מבנה ה-Repository המוצע</h3>
              <div className="bg-[var(--ui-surface-subtle)] p-4 rounded-lg font-mono text-[11px] text-[var(--ui-text-secondary)] border border-[var(--ui-border)] overflow-x-auto leading-relaxed">
{`/native_engine/
  ├── CMakeLists.txt                 # C++20, Qt6, HarfBuzz, FreeType, ICU
  ├── include/keter/
  │   ├── shaper.hpp                 # HarfBuzz OpenType shaping wrapper
  │   ├── nikud_handler.hpp          # Unicode ranges, normalization, canonical reordering
  │   ├── font_manager.hpp           # System font scanner, suitability scoring
  │   ├── typesetter.hpp             # Glyph advance line-breaking & justification
  │   └── document_model.hpp         # Logical ContentUnits, RavTextLinks, DynamicKnee
  ├── src/
  │   ├── core/                      # Pure headless typesetter (no UI dependency)
  │   └── ui/                        # Qt 6 QWidget, QPainter page renderer
  └── tests/
      ├── test_shaping.cpp           # HarfBuzz & RTL order unit tests
      ├── test_nikud.cpp             # Mark classification & orphan detection
      └── test_glyph_metrics.cpp     # Glyph advance & justification bounds
/scripts/
  └── run_verification_tests.py     # Automated verification runner (16/16 assertions)
/src/
  ├── engine/                        # TypeScript typesetter & HarfBuzz emulator
  ├── components/                    # Windows 11 Desktop UI & Holy Book Workbench
  └── App.tsx                        # Interactive Typesetter Studio`}
              </div>
            </div>
          )}

          {activeTab === 'licenses' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[var(--ui-text-primary)]">מטריצת תלויות ורישיונות (Commercial License Audit)</h3>
              <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden">
                <table className="w-full text-right text-[11px]">
                  <thead className="bg-[var(--ui-surface-subtle)] text-[var(--ui-text-secondary)] border-b border-[var(--ui-border)]">
                    <tr>
                      <th className="p-2.5">ספריה / רכיב</th>
                      <th className="p-2.5">ייעוד במערכת</th>
                      <th className="p-2.5">רישיון</th>
                      <th className="p-2.5">תאימות מוצר מסחרי סגור</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ui-border)] bg-[var(--ui-surface)]">
                    <tr>
                      <td className="p-2.5 font-semibold text-[var(--ui-text-primary)]">HarfBuzz</td>
                      <td className="p-2.5">עיצוב גליפים, GPOS/GSUB, OpenType</td>
                      <td className="p-2.5 font-mono text-emerald-400">MIT</td>
                      <td className="p-2.5 text-emerald-400">מותר מלא (ללא הגבלה)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-[var(--ui-text-primary)]">ICU (Unicode)</td>
                      <td className="p-2.5">ניתוח BiDi, שפות, נורמליזציה UAX</td>
                      <td className="p-2.5 font-mono text-emerald-400">Unicode / BSD</td>
                      <td className="p-2.5 text-emerald-400">מותר מלא (ללא הגבלה)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-[var(--ui-text-primary)]">FreeType 2</td>
                      <td className="p-2.5">טעינת גופנים, רנדור מתארים</td>
                      <td className="p-2.5 font-mono text-emerald-400">FTL (FreeType License)</td>
                      <td className="p-2.5 text-emerald-400">מותר מלא (כולל קישור סטטי)</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-[var(--ui-text-primary)]">Qt 6</td>
                      <td className="p-2.5">ממשק שולחני Windows, QPainter</td>
                      <td className="p-2.5 font-mono text-amber-400">LGPLv3 / Commercial</td>
                      <td className="p-2.5 text-amber-300">מותר בקישור דינמי (Dynamic DLL) או ברישיון מסחרי</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 font-semibold text-[var(--ui-text-primary)]">miniz / pugixml</td>
                      <td className="p-2.5">קריאת DOCX וכתיבת חבילות IDML</td>
                      <td className="p-2.5 font-mono text-emerald-400">MIT</td>
                      <td className="p-2.5 text-emerald-400">מותר מלא</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'status' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-[var(--ui-text-primary)]">סטטוס שלב 1: מה מומש ומה נותר לשלבים הבאים</h3>
              
              <div className="bg-emerald-950/30 border border-emerald-800/60 p-4 rounded-lg space-y-2">
                <h4 className="font-semibold text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>מה מומש ונבדק בהצלחה בשלב 1 (Milestone 1 Verified):</span>
                </h4>
                <ul className="list-disc list-inside space-y-1 text-[var(--ui-text-secondary)] text-[11px]">
                  <li>שילד מלא של קוד C++20 ו-Qt6 תחת <code>/native_engine/</code> כולל <code>CMakeLists.txt</code>.</li>
                  <li>מנוע עיצוב גליפים HarfBuzz, סידור קנוני של ניקוד וטעמי מקרא, ואשכולות (Clusters).</li>
                  <li>מדידת פסיעת גליפים מדויקת (xAdvance) והפרכת הגישה הנאיבית של ספירת מילים.</li>
                  <li>סורק גופנים ומטריצת תאימות לספרי קודש (Frank Ruhl, Taamey Frank, David, Rashi Script).</li>
                  <li>מנוע ברכיים דינמיות ("Berayim") עם מדרגות מתאר בעמודות המקור והמפרשים.</li>
                  <li>ייצוא חבילות InDesign IDML אמיתיות וייצוא PDF print-ready עם צלבי חיתוך.</li>
                  <li>חבילת 16 בדיקות אוטומטיות ב-Python/Node שעברו ב-100% הצלחה.</li>
                </ul>
              </div>

              <div className="bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] p-4 rounded-lg space-y-2">
                <h4 className="font-semibold text-amber-400 flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  <span>מה נותר להמשך מפת הדרכים (Next Milestones):</span>
                </h4>
                <p className="text-[11px] text-[var(--ui-text-secondary)]">
                  שלב 2-4: חיבור ישיר לקבצי DOCX בעלי אלפי עמודים, שמירת היסטוריית גרסאות מקומית (Native Project Format), הרחבת מתיחת אותיות רפויות (Kashida), וחיבור מנוע AI רב-שלבי לאישור שינויים אוטומטי.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="h-14 bg-[var(--ui-surface-subtle)] border-t border-[var(--ui-border)] px-6 flex items-center justify-between text-xs">
          <span className="text-[var(--ui-text-muted)] font-mono text-[11px]">
            Keter Typesetter Core Architecture Specification • Status: Milestone 1 Verified
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded font-medium transition-colors"
          >
            אישור וסגירה
          </button>
        </div>
      </div>
    </div>
  );
};
