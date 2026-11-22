import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

// v0.8.1 — WHITE-SCREEN FIX (user report 2026-11-10): until this version
// there was NO ErrorBoundary anywhere in src/. A single render exception
// (an empty book paginating to zero pages left `activePage` undefined and
// the header dereferenced it) unmounted the whole window, leaving a blank
// white screen with no message and no way back. This boundary catches
// render errors, shows a friendly fallback instead of white, and logs the
// error to localStorage (`keter-last-error`, last 5) so the cause can be
// diagnosed instead of guessed.

const LAST_ERROR_KEY = 'keter-last-error';

export function readLastErrors(): Array<{
  message: string;
  stack?: string;
  componentStack?: string;
  area: string;
  time: string;
}> {
  try {
    const raw = localStorage.getItem(LAST_ERROR_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Which area crashed — recorded in the log (e.g. 'workspace', 'page-canvas', 'app'). */
  label?: string;
  /** Go back to a safe view (e.g. Home). Called after the boundary resets itself. */
  onReset?: () => void;
  /** Open the New Project flow. Shown only when provided. */
  onNewProject?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      const prev = readLastErrors();
      const entry = {
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack ?? undefined,
        area: this.props.label ?? 'app',
        time: new Date().toISOString(),
      };
      localStorage.setItem(LAST_ERROR_KEY, JSON.stringify([...prev.slice(-4), entry]));
    } catch {
      // Logging must never throw — the fallback UI matters more than the log.
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorFallback
        error={this.state.error}
        onReset={this.props.onReset ? this.handleReset : undefined}
        onReload={this.handleReload}
        onNewProject={this.props.onNewProject}
      />
    );
  }
}

function ErrorFallback({
  error,
  onReset,
  onReload,
  onNewProject,
}: {
  error: Error;
  onReset?: () => void;
  onReload: () => void;
  onNewProject?: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      dir="rtl"
      className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center bg-[var(--ui-workspace-bg)] text-[var(--ui-text)] min-h-0 overflow-auto"
      role="alert"
    >
      <div className="text-4xl" aria-hidden>
        ⚠️
      </div>
      <h2 className="text-lg font-bold">{t('משהו השתבש')}</h2>
      <p className="text-sm text-[var(--ui-text-secondary)] max-w-md">
        {t('האפליקציה נתקלה בשגיאה ולא יכלה להציג את המסך הזה. העבודה שלכם נשמרה — בחרו אחת מהאפשרויות:')}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        <button
          type="button"
          onClick={onReload}
          className="px-4 py-2 rounded-lg bg-[var(--ui-accent)] text-white text-sm font-semibold hover:opacity-90"
        >
          {t('טעינה מחדש')}
        </button>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="px-4 py-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] text-sm hover:bg-[var(--ui-hover)]"
          >
            {t('חזרה לדף הבית')}
          </button>
        )}
        {onNewProject && (
          <button
            type="button"
            onClick={onNewProject}
            className="px-4 py-2 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] text-sm hover:bg-[var(--ui-hover)]"
          >
            {t('פרויקט חדש')}
          </button>
        )}
      </div>
      <details className="text-xs text-[var(--ui-text-secondary)] max-w-lg text-start">
        <summary className="cursor-pointer">{t('פרטי השגיאה (לדיווח)')}</summary>
        <pre className="mt-1 p-2 rounded bg-[var(--ui-surface)] border border-[var(--ui-border)] overflow-auto whitespace-pre-wrap break-words">
          {error.message}
          {error.stack ? `\n${error.stack}` : ''}
        </pre>
      </details>
    </div>
  );
}
