import React from 'react';
import { DynamicKneeContour, KneeCustomSettings } from '../types/typesetter';
import { Sliders, X, ArrowLeft, ArrowRight, Minus } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface DynamicKneeInspectorProps {
  knee: DynamicKneeContour;
  kneeSettings: KneeCustomSettings;
  onUpdateSettings: (settings: KneeCustomSettings) => void;
  onClose?: () => void;
  isDocked?: boolean;
}

export const DynamicKneeInspector: React.FC<DynamicKneeInspectorProps> = ({
  knee,
  kneeSettings,
  onUpdateSettings,
  onClose,
  isDocked = true,
}) => {
  const { t, dir } = useLanguage();
  const containerClass = isDocked
    ? 'flex flex-col h-full bg-[#0F1623] text-slate-200 select-none overflow-hidden'
    : 'fixed inset-y-0 left-0 w-88 bg-[#0F1623] border-r border-slate-800 shadow-2xl z-40 flex flex-col text-slate-200 select-none';

  return (
    <div dir={dir} className={containerClass}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between bg-[#0B0F17] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#D4AF37]/15 border border-[#D4AF37]/35 flex items-center justify-center text-[#E6C665]">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-slate-100">
              
              {t("ברכיים דינמיות ומדרגות עמוד")}
            </h2>
            <p className="text-[10px] text-slate-400">
              
              {t("איזון גמרא, רש״י ותוספות סביב המקור")}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-100"
            title={t("סגור")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Upper Knee Setting */}
        <div className="bg-[#0B0F17] p-3.5 rounded-xl border border-slate-800 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-slate-200 font-semibold">
              
              {t("שורות עטיפה עליונה מעל הגמרא:")}
            </span>
            <span className="font-mono text-[#E6C665] font-bold">
              {kneeSettings.upperKneeLines ?? 4}  {t("שורות")}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="8"
            value={kneeSettings.upperKneeLines ?? 4}
            onChange={e =>
              onUpdateSettings({ ...kneeSettings, upperKneeLines: Number(e.target.value) })
            }
            className="w-full accent-[#D4AF37] cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>{t("ללא (0)")}</span>
            <span>{t("וילנא (4 שורות)")}</span>
            <span>{t("גבוה (8)")}</span>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="bg-[#0B0F17] p-1 rounded-xl border border-slate-800 flex gap-1">
          <button
            onClick={() => onUpdateSettings({ ...kneeSettings, mode: 'auto' })}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              kneeSettings.mode === 'auto'
                ? 'bg-[#D4AF37] text-[#0B0F17] font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            
            {t("איזון אוטומטי")}
          </button>
          <button
            onClick={() => onUpdateSettings({ ...kneeSettings, mode: 'manual' })}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              kneeSettings.mode === 'manual'
                ? 'bg-[#D4AF37] text-[#0B0F17] font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            
            {t("כוונון ידני")}
          </button>
        </div>

        {/* Manual Sliders & Controls */}
        {kneeSettings.mode === 'manual' ? (
          <div className="space-y-4 bg-[#0B0F17] p-3.5 rounded-xl border border-slate-800">
            <div>
              <label className="text-slate-300 font-medium block mb-2">{t("כיוון מדרגת הברך:")}</label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => onUpdateSettings({ ...kneeSettings, stepDirection: 'left' })}
                  className={`p-2 rounded-lg border text-[11px] font-medium flex flex-col items-center gap-1 ${
                    kneeSettings.stepDirection === 'left'
                      ? 'bg-[#192338] border-[#D4AF37] text-[#E6C665]'
                      : 'bg-[#131B2B]/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowLeft className="w-4 h-4 text-[#D4AF37]" />
                  <span>{t("שמאלה (רש״י)")}</span>
                </button>

                <button
                  onClick={() => onUpdateSettings({ ...kneeSettings, stepDirection: 'right' })}
                  className={`p-2 rounded-lg border text-[11px] font-medium flex flex-col items-center gap-1 ${
                    kneeSettings.stepDirection === 'right'
                      ? 'bg-[#192338] border-[#D4AF37] text-[#E6C665]'
                      : 'bg-[#131B2B]/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowRight className="w-4 h-4 text-sky-400" />
                  <span>{t("ימינה (תוספות)")}</span>
                </button>

                <button
                  onClick={() => onUpdateSettings({ ...kneeSettings, stepDirection: 'none' })}
                  className={`p-2 rounded-lg border text-[11px] font-medium flex flex-col items-center gap-1 ${
                    kneeSettings.stepDirection === 'none'
                      ? 'bg-[#192338] border-[#D4AF37] text-[#E6C665]'
                      : 'bg-[#131B2B]/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Minus className="w-4 h-4 text-slate-400" />
                  <span>{t("ללא מדרגה")}</span>
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300">{t("גובה צומת מדרגת הברך:")}</span>
                <span className="font-mono text-[#E6C665] font-bold">
                  {kneeSettings.junctionPercent}%
                </span>
              </div>
              <input
                type="range"
                min="20"
                max="80"
                value={kneeSettings.junctionPercent}
                onChange={e =>
                  onUpdateSettings({ ...kneeSettings, junctionPercent: Number(e.target.value) })
                }
                className="w-full accent-[#D4AF37] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300">{t("רוחב המדרגה התחתונה:")}</span>
                <span className="font-mono text-[#E6C665] font-bold">
                  {kneeSettings.lowerWidthPercent}%
                </span>
              </div>
              <input
                type="range"
                min="40"
                max="95"
                value={kneeSettings.lowerWidthPercent}
                onChange={e =>
                  onUpdateSettings({ ...kneeSettings, lowerWidthPercent: Number(e.target.value) })
                }
                className="w-full accent-[#D4AF37] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300">{t("מרווח בין עמודות (Gutter):")}</span>
                <span className="font-mono text-[#E6C665] font-bold" dir="ltr">
                  {kneeSettings.gutterWidth} pt
                </span>
              </div>
              <input
                type="range"
                min="6"
                max="24"
                value={kneeSettings.gutterWidth}
                onChange={e =>
                  onUpdateSettings({ ...kneeSettings, gutterWidth: Number(e.target.value) })
                }
                className="w-full accent-[#D4AF37] cursor-pointer"
              />
            </div>
          </div>
        ) : (
          <div className="bg-[#131B2B] border border-[#D4AF37]/30 rounded-xl p-3.5 text-slate-200 text-xs leading-relaxed">
            <p className="font-semibold text-[#E6C665] mb-1">{t("איזון ברכיים אוטומטי פעיל:")}</p>
            <p className="text-[11px] text-slate-300">
              
              {t("מנוע העימוד מודד את יחס המילים בין רש״י לתוספות בעמוד וממקם את צומת המדרגה באופן הרמוני.")}
            </p>
          </div>
        )}

        {/* Live Metrics Summary */}
        <div className="bg-[#0B0F17] rounded-xl border border-slate-800 p-3.5 space-y-2 text-xs">
          <span className="font-semibold text-slate-300 block mb-1">
            
            {t("מידות גזרה בעמוד הנוכחי:")}
          </span>
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span className="text-slate-400">{t("רוחב מקור עליון:")}</span>
            <span className="font-mono text-[#E6C665]" dir="ltr">
              {knee.upperSourceWidth.toFixed(1)} pt
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span className="text-slate-400">{t("רוחב מקור תחתון:")}</span>
            <span className="font-mono text-[#E6C665]" dir="ltr">
              {knee.lowerSourceWidth.toFixed(1)} pt
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span className="text-slate-400">{t("גובה נקודת צומת:")}</span>
            <span className="font-mono text-sky-400" dir="ltr">
              {knee.kneeJunctionY.toFixed(1)} pt
            </span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">{t("כיוון גזירה:")}</span>
            <span className="font-medium text-slate-200">
              {knee.isLeftStepped ? t("מדרגה שמאלה (הרחבה לרש״י)") : t("מדרגה ימינה (הרחבה לתוספות)")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
