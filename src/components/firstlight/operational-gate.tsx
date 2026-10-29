/* FirstLight — operational-mode authentication gate.
 *
 * DEMO builds never render this component (page.tsx only mounts it when
 * DEMO_MODE=false). It provides the pilot login form against
 * POST /api/auth/login and surfaces the honest mode notice.
 */

'use client';

import { useState } from 'react';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ClientSession } from '@/lib/firstlight/server-client';

export function OperationalGate({
  onAuthenticated,
}: {
  onAuthenticated: (s: ClientSession) => void;
}) {
  const [email, setEmail] = useState('analyst@firstlight.example');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, token }),
      });
      const json = (await res.json()) as {
        data?: { token: string; user: { id: string; name: string; role: string; email: string } };
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `Login failed (${res.status})`);
        return;
      }
      onAuthenticated({ token: json.data.token, user: json.data.user });
    } catch {
      setError('Network error — is the operational server running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <svg width="40" height="40" viewBox="0 0 64 64" className="shrink-0">
            <rect width="64" height="64" rx="14" fill="#18181b" />
            <path d="M14 46a18 18 0 0 1 36 0z" fill="#f59e0b" />
            <circle cx="32" cy="46" r="5.5" fill="#fde68a" />
            <rect x="10" y="49" width="44" height="3.5" rx="1.75" fill="#f59e0b" />
          </svg>
          <div>
            <div className="font-black tracking-tight text-xl">FirstLight</div>
            <div className="text-[10px] font-semibold tracking-[0.2em] text-zinc-500">
              OPERATIONAL MODE · AUTHENTICATED ACCESS
            </div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="fl-email" className="text-xs text-zinc-400">
              Account email
            </Label>
            <Input
              id="fl-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-zinc-900 border-zinc-700"
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fl-token" className="text-xs text-zinc-400">
              Account token (pilot credential — see SECURITY.md)
            </Label>
            <Input
              id="fl-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="bg-zinc-900 border-zinc-700 font-mono"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-400 border border-red-500/30 bg-red-500/10 rounded p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <Button
            type="submit"
            disabled={busy}
            className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Sign in
              </>
            )}
          </Button>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Pilot auth uses out-of-band account tokens seeded by
            <code className="mx-1 text-zinc-400">bun run db:seed</code>. Production
            replaces this with OIDC/SAML + MFA — the session/role seam is designed
            so only login() changes. Every API call validates the bearer
            server-side; this gate is UX, not the security boundary.
          </p>
        </form>
      </div>
    </div>
  );
}
