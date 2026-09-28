import { onBackButtonPress } from '@tauri-apps/api/app';
import { useEffect, useRef } from 'react';
import type { PageId } from './navigation';

/** Handles app-owned navigation while preserving Tauri's default Android exit behavior. */
export function useAndroidBackNavigation(
  enabled: boolean,
  page: PageId,
  setPage: (page: PageId) => void,
) {
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let registering = false;
    let listener: Awaited<ReturnType<typeof onBackButtonPress>> | undefined;
    const needsListener = () =>
      pageRef.current !== 'schedule' || !!document.querySelector('dialog[open], .ui-popover');

    const reconcile = () => {
      if (disposed) return;
      if (needsListener()) {
        if (listener || registering) return;
        registering = true;
        void onBackButtonPress(() => {
          const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
          const topDialog = dialogs.item(dialogs.length - 1);
          if (topDialog) {
            topDialog.dispatchEvent(new Event('cancel', { cancelable: true }));
            return;
          }
          if (document.querySelector('.ui-popover')) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return;
          }
          if (pageRef.current !== 'schedule') setPage('schedule');
        })
          .then((registered) => {
            registering = false;
            if (disposed || !needsListener()) void registered.unregister();
            else listener = registered;
          })
          .catch(() => {
            registering = false;
          });
      } else if (listener) {
        const current = listener;
        listener = undefined;
        void current.unregister();
      }
    };

    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['open'],
      childList: true,
      subtree: true,
    });
    reconcile();

    return () => {
      disposed = true;
      observer.disconnect();
      if (listener) void listener.unregister();
    };
  }, [enabled, setPage]);
}
