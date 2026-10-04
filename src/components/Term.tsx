import type { ReactNode } from 'react';
import { glossary } from '../data/glossary';
import type { GlossaryKey } from '../data/glossary';

interface Props {
  id: GlossaryKey;
  children: ReactNode;
}

// Inline jargon with a plain-language popover. Pure CSS (hover or keyboard
// focus), so it works with Tab and needs no state. role="note" keeps the
// definition readable to screen readers without a separate tooltip widget.
export function Term({ id, children }: Props) {
  const entry = glossary[id];
  return (
    <span className="term" tabIndex={0}>
      {children}
      <span className="term-pop" role="note">
        <strong>{entry.term}</strong>
        {entry.short}
      </span>
    </span>
  );
}
