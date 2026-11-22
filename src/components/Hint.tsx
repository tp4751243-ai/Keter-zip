import React from 'react';

/**
 * v0.4.0 (UX overhaul) — one-line plain-language hint shown under or beside
 * a complex control. Explains what the control does and what a good choice
 * looks like, in words a non-technical user understands.
 */
export const Hint: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <p className={`keter-hint text-[11px] leading-snug text-[var(--ui-text-secondary)] ${className}`}>
    {children}
  </p>
);
