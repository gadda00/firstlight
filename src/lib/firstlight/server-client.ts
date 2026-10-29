/* ==========================================================================
 * FirstLight — operational-mode client API helper.
 *
 * Browser-side companion to the /api surface: bearer-session storage, the
 * error-envelope contract, and typed fetchers that rebuild the exact
 * EventRawData / EventDecisionData shapes the (demo-built) UI components
 * already know how to render. The server remains the single source of
 * truth — the client never recomputes what it did not receive.
 *
 * This module is only imported on the operational code path (demo builds
 * tree-shake it away via the `!isDemo` gates in the components).
 * ========================================================================== */

'use client';

import type { EventDecisionData, EventRawData } from './types';
import type { ScoreManifest } from './scoring';

/* ------------------------------------------------------------------ session */

const SESSION_KEY = 'firstlight.session';

export interface ClientSession {
  token: string;
  user: { id: string; name: string; role: string; email: string };
}

export function getSession(): ClientSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ClientSession) : null;
  } catch {
    return null;
  }
}

export function setSession(s: ClientSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------- envelope */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; retryable?: boolean };
}

/** Fetch + bearer + envelope unwrapping. Throws ApiError on any failure. */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = getSession();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body) headers['content-type'] = 'application/json';
  if (session?.token) headers.authorization = `Bearer ${session.token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network_error', 'Server unreachable');
  }
  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, 'bad_response', `Non-JSON response (${res.status})`);
  }
  if (!res.ok || json.error) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'unknown',
      json.error?.message ?? `Request failed (${res.status})`,
      json.error?.retryable ?? false,
    );
  }
  return json.data as T;
}

/* ------------------------------------------------------------- event summaries */

export interface ServerEventSummary {
  id: string;
  name: string;
  archetype: string;
  status: string;
  country: string;
  location: string;
  incidentTime: string;
  demoLayer: boolean;
  counts: { assets: number; reviewTasks: number; sitreps: number; exports: number };
}

export async function listEvents(): Promise<ServerEventSummary[]> {
  const data = await apiFetch<{ events: ServerEventSummary[] }>('/events');
  return data.events;
}

/* ------------------------------------------------------------------ the layer */

export interface LayerResponse {
  event: {
    id: string;
    name: string;
    archetype: string;
    status: string;
    country: string;
    location: string;
    center: { lat: number; lng: number };
    aoiKm: number;
    incidentTime: string;
    demoLayer: boolean;
  };
  demo: EventRawData['demo'];
  manifest: ScoreManifest;
  stats: EventDecisionData['stats'];
  zones: EventDecisionData['zones'];
  facilities: EventRawData['facilities'];
  roads: EventRawData['roads'];
  floods: EventRawData['floods'];
  buildings: EventRawData['buildings'];
  popGrid: EventRawData['popGrid'];
  meta: EventRawData['meta'];
  stages: EventRawData['stages'];
  totalPop: number;
  version: number;
}

/** Fetch an event's decision layer and rebuild the full client-side types
 * (the only non-JSON member, zoneIndex, is reconstructed here). */
export async function fetchEventLayer(
  eventId: string,
): Promise<{ raw: EventRawData; decision: EventDecisionData; event: LayerResponse['event']; manifest: ScoreManifest }> {
  const r = await apiFetch<LayerResponse>(`/events/${encodeURIComponent(eventId)}/layer`);
  const raw: EventRawData = {
    meta: r.meta,
    buildings: r.buildings,
    roads: r.roads,
    facilities: r.facilities,
    popGrid: r.popGrid,
    floods: r.floods,
    stages: r.stages,
    totalPop: r.totalPop,
    ...(r.demo ? { demo: r.demo } : {}),
  };
  const decision: EventDecisionData = {
    zones: r.zones,
    zoneIndex: new Map(r.zones.map((z) => [z.id, z])),
    stats: r.stats,
    routes: [],
  };
  return { raw, decision, event: r.event, manifest: r.manifest };
}

/* ------------------------------------------------------- review / sitrep / exports */

export interface ReviewTaskView {
  id: string;
  eventId: string;
  targetId: string;
  targetType: string;
  reason: string;
  modelConfidence: number;
  priority: number;
  status: string;
  version: number;
  dueAt: string | null;
  decisions: Array<{
    decision: string;
    newClass: string | null;
    reason: string;
    notes: string | null;
    reviewer: string;
    reviewerRole: string;
    createdAt: string;
  }>;
}

export async function listReviewTasks(eventId: string): Promise<ReviewTaskView[]> {
  const data = await apiFetch<{ tasks: ReviewTaskView[] }>(
    `/events/${encodeURIComponent(eventId)}/review/tasks`,
  );
  return data.tasks;
}

export async function decideReviewTask(
  taskId: string,
  body: { decision: string; reason: string; newClass?: string; notes?: string; version: number },
): Promise<void> {
  await apiFetch(`/review/tasks/${encodeURIComponent(taskId)}/decide`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface SitrepDraftView {
  id: string;
  version: number;
  status: string;
  claimsHash: string;
  approvedBy: string | null;
  approvedAt: string | null;
  markdown: string;
  createdAt: string;
}

export async function listSitrepDrafts(eventId: string): Promise<SitrepDraftView[]> {
  const data = await apiFetch<{ drafts: SitrepDraftView[] }>(
    `/events/${encodeURIComponent(eventId)}/sitrep`,
  );
  return data.drafts;
}

export async function generateServerSitrep(eventId: string): Promise<SitrepDraftView> {
  const data = await apiFetch<{ draft: SitrepDraftView }>(
    `/events/${encodeURIComponent(eventId)}/sitrep/generate`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return data.draft;
}

export async function approveServerSitrep(
  draftId: string,
  body: { expectedVersion: number; reason?: string },
): Promise<SitrepDraftView> {
  const data = await apiFetch<{ draft: SitrepDraftView }>(
    `/sitrep/${encodeURIComponent(draftId)}/approve`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return data.draft;
}

export interface ExportView {
  id: string;
  kind: string;
  sha256: string;
  sizeBytes: number;
  approvalState: string;
  createdAt: string;
}

export interface BundleView {
  id: string;
  sha256: string;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

export async function listExports(
  eventId: string,
): Promise<{ exports: ExportView[]; bundles: BundleView[] }> {
  return apiFetch<{ exports: ExportView[]; bundles: BundleView[] }>(
    `/events/${encodeURIComponent(eventId)}/exports`,
  );
}

export async function createServerExport(
  eventId: string,
  kind: string,
): Promise<{ filename: string; sha256: string; sizeBytes: number; contentType: string; body: string }> {
  const data = await apiFetch<{
    export: { filename: string; sha256: string; sizeBytes: number; contentType: string };
    body: string;
  }>(`/events/${encodeURIComponent(eventId)}/exports`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
  return { ...data.export, body: data.body };
}

export async function createServerBundle(
  eventId: string,
  ttlHours: number,
): Promise<{ filename: string; sha256: string; sizeBytes: number; body: string }> {
  const data = await apiFetch<{
    bundle: { filename: string; sha256: string; sizeBytes: number };
    body: string;
  }>(`/events/${encodeURIComponent(eventId)}/bundle`, {
    method: 'POST',
    body: JSON.stringify({ ttlHours }),
  });
  return { ...data.bundle, body: data.body };
}

/* --------------------------------------------------------------------- logout */

export async function serverLogout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  } catch {
    /* revocation is best-effort client-side; clearing the session locally
       still removes the credential from this browser. */
  }
  clearSession();
}

/* ------------------------------------------------------------------ downloads */

/** Save a server-built export body as a local file download. */
export function downloadText(filename: string, body: string, contentType: string): void {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
