import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function SettingsDialog({ children, onClose, closingDisabled }: { children: ComponentChildren; onClose: () => void; closingDisabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      element.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      class="calendar-settings"
      aria-labelledby="calendar-settings-title"
      onCancel={(event) => { event.preventDefault(); if (!closingDisabled) onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !closingDisabled) onClose(); }}
    >
      <div class="calendar-settings__panel">{children}</div>
    </dialog>
  );
}
