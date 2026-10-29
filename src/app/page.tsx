'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/firstlight/app-shell';
import { useFirstLight } from '@/store/firstlight';
import { EVENTS } from '@/lib/firstlight/events';
import { demoModeEnabled } from '@/lib/firstlight/mode';
import { OperationalGate } from '@/components/firstlight/operational-gate';
import {
  clearSession,
  getSession,
  setSession,
  type ClientSession,
} from '@/lib/firstlight/server-client';

export default function Home() {
  const loadEvent = useFirstLight((s) => s.loadEvent);
  const phase = useFirstLight((s) => s.phase);
  const decision = useFirstLight((s) => s.decision);
  const loadServerEvents = useFirstLight((s) => s.loadServerEvents);
  const loadServerEvent = useFirstLight((s) => s.loadServerEvent);
  const isDemo = demoModeEnabled();
  const [session, setSessionState] = useState<ClientSession | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isDemo) return;
    // Operational mode: restore a remembered session (pilot convenience —
    // the server validates the bearer on every API call regardless).
    let cancelled = false;
    void (async () => {
      const restored = getSession();
      if (cancelled) return;
      setSessionState(restored);
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  // Demo mode: boot the first event pipeline once on mount (unchanged).
  useEffect(() => {
    if (!isDemo) return;
    if (!decision && phase === 'idle') {
      loadEvent(EVENTS[0].id);
    }
  }, []);

  // Operational bootstrap: with a live session, list the org's events and
  // auto-load the most recent one so the map + panels render server-built
  // data from the first frame. An expired/revoked session bounces back to
  // the login gate (clearSession removes the stale credential).
  useEffect(() => {
    if (isDemo || !session) return;
    let cancelled = false;
    void (async () => {
      try {
        const events = await loadServerEvents();
        if (cancelled || events.length === 0) return;
        await loadServerEvent(events[0].id);
      } catch (err) {
        if (cancelled) return;
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
          clearSession();
          setSessionState(null);
        }
        // Other errors surface through the store's serverError banner.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, isDemo, loadServerEvents, loadServerEvent]);

  if (!isDemo && !session && checked) {
    return (
      <OperationalGate
        onAuthenticated={(s) => {
          setSession(s);
          setSessionState(s);
        }}
      />
    );
  }

  return <AppShell />;
}
