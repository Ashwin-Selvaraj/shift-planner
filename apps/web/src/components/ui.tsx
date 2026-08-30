/** Small presentational primitives shared across pages. */
import type { ReactNode } from 'react';
import { ISSUE_LABELS } from '../lib/format';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
        aria-hidden
      />
      {label}…
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-base font-medium text-slate-800">{title}</p>
      {description ? <p className="max-w-md text-sm text-slate-500">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="card border-rose-200 bg-rose-50 px-5 py-4">
      <p className="text-sm font-medium text-rose-800">{message}</p>
      {onRetry ? (
        <button type="button" className="btn-secondary mt-3" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const tones: Record<string, string> = {
    neutral: 'text-slate-900',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-rose-600',
  };
  return (
    <div className="card px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/**
 * Validation summary. Criticals and warnings are visually separated because the
 * distinction decides whether the roster can be published at all (BRD 25).
 */
export function ValidationPanel({
  validation,
  limit = 12,
}: {
  validation: {
    issues: Array<{
      code: string;
      severity: 'CRITICAL' | 'WARNING';
      message: string;
      date?: string;
    }>;
    criticalCount: number;
    warningCount: number;
    canPublish: boolean;
  } | null;
  limit?: number;
}) {
  if (!validation) {
    return (
      <div className="card px-5 py-4 text-sm text-slate-500">
        This roster has not been validated yet.
      </div>
    );
  }

  const criticals = validation.issues.filter((i) => i.severity === 'CRITICAL');
  const warnings = validation.issues.filter((i) => i.severity === 'WARNING');

  return (
    <div className="card overflow-hidden">
      <div
        className={`flex flex-wrap items-center gap-3 border-b px-5 py-3 ${
          validation.canPublish
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-rose-200 bg-rose-50'
        }`}
      >
        <span
          className={`badge ${
            validation.canPublish
              ? 'bg-emerald-200 text-emerald-900'
              : 'bg-rose-200 text-rose-900'
          }`}
        >
          {validation.canPublish ? 'Ready to publish' : 'Publication blocked'}
        </span>
        <span className="text-sm text-slate-600">
          {validation.criticalCount} critical · {validation.warningCount} warnings
        </span>
      </div>

      <div className="max-h-80 space-y-1 overflow-y-auto px-4 py-3 thin-scroll">
        {validation.issues.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-500">
            No issues found. Every wellness and coverage rule passes.
          </p>
        ) : (
          [...criticals, ...warnings].slice(0, limit).map((issue, index) => (
            <div
              key={`${issue.code}-${issue.date ?? index}-${index}`}
              className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
            >
              <span
                className={`badge mt-0.5 shrink-0 ${
                  issue.severity === 'CRITICAL'
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {ISSUE_LABELS[issue.code] ?? issue.code}
              </span>
              <span className="text-sm text-slate-600">{issue.message}</span>
            </div>
          ))
        )}
        {validation.issues.length > limit ? (
          <p className="px-2 pt-2 text-xs text-slate-500">
            …and {validation.issues.length - limit} more.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="card max-h-[85vh] w-full max-w-lg overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 thin-scroll">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Toast({
  message,
  tone,
  onDismiss,
}: {
  message: string;
  tone: 'success' | 'error';
  onDismiss: () => void;
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 max-w-md rounded-lg px-4 py-3 text-sm shadow-lg ${
        tone === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
      }`}
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="flex-1">{message}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-80">
          ✕
        </button>
      </div>
    </div>
  );
}
