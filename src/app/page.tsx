'use client';

import { useEffect } from 'react';
import { AppShell } from '@/components/firstlight/app-shell';
import { useFirstLight } from '@/store/firstlight';
import { EVENTS } from '@/lib/firstlight/events';

export default function Home() {
  const loadEvent = useFirstLight((s) => s.loadEvent);
  const phase = useFirstLight((s) => s.phase);
  const decision = useFirstLight((s) => s.decision);

  useEffect(() => {
    // boot the first event pipeline once on mount
    if (!decision && phase === 'idle') {
      loadEvent(EVENTS[0].id);
    }
  }, []);

  return <AppShell />;
}
