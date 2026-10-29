'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/firstlight/app-shell';
import { useFirstLight } from '@/store/firstlight';
import { EVENTS } from '@/lib/firstlight/events';
import { demoModeEnabled } from '@/lib/firstlight/mode';
import { OperationalGate } from '@/components/firstlight/operational-gate';

export default function Home() {
  const loadEvent = useFirstLight((s) => s.loadEvent);
  const phase = useFirstLight((s) => s.phase);
  const decision = useFirstLight((s) => s.decision);
  const isDemo = demoModeEnabled();
  const [session, setSession] = useState<null | {
    user: { name: string; role: string };
    token: string;
  }>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isDemo) {
      // Operational mode: restore a remembered session (pilot convenience —
      // the server validates the bearer on every API call regardless).
      try {
        const raw = sessionStorage.getItem('firstlight.session');
        if (raw) setSession(JSON.parse(raw));
      } finally {
        setChecked(true);
      }
      return;
    }
    // Demo mode: boot the first event pipeline once on mount (unchanged).
    if (!decision && phase === 'idle') {
      loadEvent(EVENTS[0].id);
    }
  }, []);

  if (!isDemo && !session && checked) {
    return (
      <OperationalGate
        onAuthenticated={(s) => {
          sessionStorage.setItem('firstlight.session', JSON.stringify(s));
          setSession(s);
        }}
      />
    );
  }

  return <AppShell />;
}
