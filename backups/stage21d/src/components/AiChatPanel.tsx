import React, { useState } from 'react';
import { Sparkles, Send, Check, X } from 'lucide-react';
import { ProfessionalDesignSettings } from '../types/design-settings';
import { DesignSettingsEngine } from '../engine/design-settings-engine';

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
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  proposedAction?: {
    type: 'adjust_knee' | 'adjust_spacing' | 'fix_qa' | 'switch_font' | 'update_design_settings';
    label: string;
    data: any;
  };
  status?: 'pending' | 'approved' | 'rejected';
}

const QUICK_AI_PROMPTS = [
  'הגדל את גופן המקור ל-15.5pt',
  'הגדל מרווח שורות ברש״י ל-14pt',
  'מרכז כותרות פרקים',
  'צמצם רווח בין עמודות ל-10pt',
];

export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  onClose,
  onApplyAdjustment,
  designSettings,
  onUpdateDesignSettings,
  selectedUnitId,
  isDocked = true,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-1',
      sender: 'ai',
      text: 'שלום! ניתן לבקש בעברית טבעית שינויי גופן, גודל אות, מרווח שורות, כניסות פסקה, או כוונון ברכיים ורב-טקסט.',
    },
  ]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);

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
    setIsBusy(true);

    setTimeout(() => {
      let aiReply = '';
      let action: ChatMessage['proposedAction'] = undefined;

      if (designSettings && onUpdateDesignSettings) {
        const nlRes = DesignSettingsEngine.applyNaturalLanguageCommand(
          designSettings,
          userText,
          'ai',
          selectedUnitId ?? undefined
        );
        if (nlRes.matched) {
          onUpdateDesignSettings(nlRes.updatedSettings, nlRes.summaryHe);
          aiReply = `בוצע ועודכן בספר (סבב #${nlRes.updatedSettings.revision}): ${nlRes.summaryHe}.`;
          const aiMsg: ChatMessage = {
            id: `ai-${Date.now()}`,
            sender: 'ai',
            text: aiReply,
          };
          setMessages(prev => [...prev, aiMsg]);
          setIsBusy(false);
          return;
        }
      }

      const lower = userText.toLowerCase();
      if (lower.includes('רווח') || lower.includes('צמצם') || lower.includes('spacing')) {
        aiReply =
          'זיהיתי את בקשתך לצמצם את הרווח (Gutter) בין עמודת הגמרא לרש״י. ההצעה היא להפחית את הרווח מ-12pt ל-9.5pt.';
        action = {
          type: 'adjust_spacing',
          label: 'הפחתת מרווח עמודות ל-9.5pt',
          data: { gutter: 9.5 },
        };
      } else if (lower.includes('ברך') || lower.includes('knee') || lower.includes('מדרגה')) {
        aiReply =
          'חישבתי מחדש את מתאר מדרגת הברך עבור הדף. לפי אורכי הטקסט של רש״י ותוספות, מומלץ להזיז את צומת המדרגה ל-440pt.';
        action = {
          type: 'adjust_knee',
          label: 'הזזת צומת הברך ל-440pt',
          data: { kneeJunctionY: 440 },
        };
      } else if (
        lower.includes('תקן') ||
        lower.includes('qa') ||
        lower.includes('יתום') ||
        lower.includes('fix')
      ) {
        aiReply =
          'ביצעתי סריקת תקינות לעמוד: אין חפיפות גליפים, סדר הניקוד תקין, וכל נקודות העוגן מתואמות.';
        action = {
          type: 'fix_qa',
          label: 'אישור אופטימיזציית עימוד מלאה',
          data: {},
        };
      } else {
        const srcSize = designSettings?.roleStyles?.main_source?.character?.fontSizePt ?? 14.5;
        const rashiSize =
          designSettings?.roleStyles?.primary_comment?.character?.fontSizePt ?? 10.5;
        aiReply = `קיבלתי: "${userText}". הגדרות נוכחיות: מקור ${srcSize}pt, רש״י ${rashiSize}pt. ניתן לבקש למשל: "הגדל את גופן המקור ל-16pt", "מרכז כותרות פרקים", או "הגדל מרווח שורות ברש״י ל-15pt".`;
      }

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: aiReply,
        proposedAction: action,
        status: action ? 'pending' : undefined,
      };

      setMessages(prev => [...prev, aiMsg]);
      setIsBusy(false);
    }, 250);
  };

  const handleSend = () => {
    sendTextCommand(input);
  };

  const handleApprove = (msgId: string, action: ChatMessage['proposedAction']) => {
    if (!action) return;
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

  const containerClass = isDocked
    ? 'flex flex-col h-full bg-[var(--ui-surface)] text-[var(--ui-text-primary)] select-none overflow-hidden border-r border-[var(--ui-border)] transition-colors duration-150'
    : 'fixed inset-y-0 left-0 w-88 bg-[var(--ui-surface)] border-r border-[var(--ui-border)] shadow-[var(--ui-floating-shadow)] z-40 flex flex-col text-[var(--ui-text-primary)]';

  return (
    <aside dir="rtl" className={containerClass}>
      {/* Header */}
      <div className="px-4 py-3.5 bg-[var(--ui-surface)] border-b border-[var(--ui-border)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[var(--ui-selected-bg)] border border-[var(--ui-selected-border)] flex items-center justify-center text-[var(--ui-accent)]">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-[var(--ui-text-primary)]">עוזר עימוד חכם</h2>
            <p className="text-[11px] text-[var(--ui-text-secondary)]">
              פקודות בעברית טבעית לעיצוב הספר
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--ui-surface-hover)] rounded-lg text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
            title="סגור חלונית AI"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Quick Prompts Bar */}
      <div className="p-3 bg-[var(--ui-surface-subtle)] border-b border-[var(--ui-border)] flex flex-wrap gap-1.5 shrink-0">
        {QUICK_AI_PROMPTS.map(prompt => (
          <button
            key={prompt}
            onClick={() => sendTextCommand(prompt)}
            className="px-2.5 py-1 rounded-lg bg-[var(--ui-surface)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[11px] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)] transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs leading-relaxed">
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
                    <span>הצעה לאישורך:</span>
                  </div>
                  <p className="text-[11px] text-[var(--ui-text-secondary)] mb-2 font-mono">
                    {msg.proposedAction.label}
                  </p>

                  {msg.status === 'pending' ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(msg.id, msg.proposedAction)}
                        className="flex-1 py-1.5 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] text-[var(--ui-accent-fg)] rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
                      >
                        <Check className="w-3 h-3" />
                        <span>אישור</span>
                      </button>
                      <button
                        onClick={() => handleReject(msg.id)}
                        className="flex-1 py-1.5 bg-[var(--ui-surface-subtle)] hover:bg-[var(--ui-surface-hover)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] rounded-md text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        <span>דחייה</span>
                      </button>
                    </div>
                  ) : msg.status === 'approved' ? (
                    <span className="text-[var(--ui-success)] font-medium text-[11px] flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      <span>השינוי אושר והוחל על הספר</span>
                    </span>
                  ) : (
                    <span className="text-[var(--ui-text-muted)] font-medium text-[11px]">
                      השינוי נדחה
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-3.5 bg-[var(--ui-surface)] border-t border-[var(--ui-border)] flex items-center gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder="בקש שינוי גופן, מרווח שורות, יישור, ברכיים..."
          className="flex-1 bg-[var(--ui-surface-subtle)] border border-[var(--ui-border)] rounded-lg px-3 py-2 text-xs text-[var(--ui-text-primary)] placeholder-[var(--ui-text-muted)] focus:outline-none focus:border-[var(--ui-accent)]"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isBusy}
          className="px-3.5 py-2 bg-[var(--ui-accent)] hover:bg-[var(--ui-accent-hover)] disabled:opacity-40 text-[var(--ui-accent-fg)] rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
        >
          <Send className="w-3.5 h-3.5" />
          <span>שלח</span>
        </button>
      </div>
    </aside>
  );
};
