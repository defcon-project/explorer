import type { ReactNode } from 'react';

type StatePanelTone = 'neutral' | 'warning' | 'danger';

interface StatePanelProps {
  title: string;
  description?: ReactNode;
  tone?: StatePanelTone;
  action?: ReactNode;
  className?: string;
}

/**
 * Shared empty, loading and recoverable-error surface.
 * Pages may add an icon or an action without rebuilding the visual treatment.
 */
export default function StatePanel({
  title,
  description,
  tone = 'neutral',
  action,
  className = '',
}: StatePanelProps) {
  return (
    <div className={`state-panel ${className}`.trim()} data-tone={tone}>
      <strong className="state-panel-title">{title}</strong>
      {description ? <div className="state-panel-description">{description}</div> : null}
      {action}
    </div>
  );
}
