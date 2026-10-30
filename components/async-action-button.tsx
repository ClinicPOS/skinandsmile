"use client";
import {useRef, useState, type ComponentProps, type MouseEvent} from 'react';

type Props = Omit<ComponentProps<'button'>, 'onClick'> & {
  onClick: (event: MouseEvent<HTMLButtonElement>) => unknown;
  busyLabel?: string;
};

// The ref blocks a second click before React has rendered the disabled state.
export function AsyncActionButton({onClick, busyLabel = 'Working...', disabled, children, ...props}: Props) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(event: MouseEvent<HTMLButtonElement>) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError('');
    try { await onClick(event); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'This action failed. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <button {...props} type={props.type || 'button'} onClick={run} disabled={disabled || busy} aria-busy={busy}>
      {busy ? busyLabel : children}
    </button>
    {error && <p role="alert" className="mt-1 text-sm text-red-700">{error}</p>}
  </>;
}
