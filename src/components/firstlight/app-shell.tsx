/* FirstLight — app shell: header + toolbar + swipe map + analysis tabs
 * + status bar. Responsive: side panel becomes stacked below on mobile. */

'use client';

import dynamic from 'next/dynamic';
import { FileSearch, Grid3x3, Route, FileText, ClipboardCheck, Download, Database, CircleDot } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Header } from './header';
import { MapToolbar } from './map-toolbar';
import { PipelineOverlay } from './pipeline-overlay';
import { OverviewPanel } from './panels/overview';
import { ZonesPanel } from './panels/zones';
import { AccessPanel } from './panels/access';
import { SitrepPanel } from './panels/sitrep';
import { ReviewPanel } from './panels/review';
import { ExportPanel } from './panels/export';
import { DataPanel } from './panels/data';
import { useFirstLight } from '@/store/firstlight';

const MapView = dynamic(() => import('./map/map-view'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-zinc-950 flex items-center justify-center">
      <div className="flex items-center gap-2 text-zinc-600 text-xs font-mono">
        <CircleDot className="h-3.5 w-3.5 animate-pulse" />
        initializing map engine…
      </div>
    </div>
  ),
});

export function AppShell() {
  const decision = useFirstLight((s) => s.decision);
  const pending = decision?.stats.pendingReview ?? 0;

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header />
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* map column */}
        <section className="flex flex-col min-h-[54vh] lg:min-h-0 flex-1 border-b lg:border-b-0 lg:border-r border-zinc-800/80">
          <MapToolbar />
          <div className="relative flex-1 min-h-[46vh]">
            <MapView />
          </div>
        </section>

        {/* analysis column */}
        <aside className="flex flex-col lg:w-[420px] xl:w-[450px] lg:flex-none min-h-0 bg-zinc-950">
          <Tabs defaultValue="overview" className="flex flex-col h-full min-h-0 gap-0">
            <TabsList className="shrink-0 rounded-none h-auto p-0 bg-transparent border-b border-zinc-800/80 flex-wrap">
              <TabTrigger value="overview" icon={<FileSearch className="h-3.5 w-3.5" />} label="Overview" />
              <TabTrigger value="zones" icon={<Grid3x3 className="h-3.5 w-3.5" />} label="Zones" count={decision?.zones.length} />
              <TabTrigger value="access" icon={<Route className="h-3.5 w-3.5" />} label="Access" />
              <TabTrigger value="sitrep" icon={<FileText className="h-3.5 w-3.5" />} label="Sitrep" />
              <TabTrigger
                value="review"
                icon={<ClipboardCheck className="h-3.5 w-3.5" />}
                label="Review"
                count={pending || undefined}
                alert={Boolean(pending)}
              />
              <TabTrigger value="export" icon={<Download className="h-3.5 w-3.5" />} label="Export" />
              <TabTrigger value="data" icon={<Database className="h-3.5 w-3.5" />} label="Data" />
            </TabsList>
            <div className="flex-1 min-h-0 overflow-y-auto fl-scroll">
              <TabsContent value="overview" className="m-0">
                <OverviewPanel />
              </TabsContent>
              <TabsContent value="zones" className="m-0">
                <ZonesPanel />
              </TabsContent>
              <TabsContent value="access" className="m-0">
                <AccessPanel />
              </TabsContent>
              <TabsContent value="sitrep" className="m-0">
                <SitrepPanel />
              </TabsContent>
              <TabsContent value="review" className="m-0">
                <ReviewPanel />
              </TabsContent>
              <TabsContent value="export" className="m-0">
                <ExportPanel />
              </TabsContent>
              <TabsContent value="data" className="m-0">
                <DataPanel />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      </main>

      <StatusBar />
      <PipelineOverlay />
    </div>
  );
}

function TabTrigger({
  value,
  icon,
  label,
  count,
  alert,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  alert?: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      className={`flex-1 min-w-0 h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-amber-500 data-[state=active]:bg-zinc-900/60 text-zinc-500 data-[state=active]:text-zinc-100 text-[10px] font-bold tracking-wide gap-1 px-1.5 sm:px-2 ${
        alert ? 'text-amber-400' : ''
      }`}
    >
      <span className="flex items-center gap-1 min-w-0 justify-center">
        {icon}
        <span className="hidden sm:inline">{label}</span>
        {typeof count === 'number' && count > 0 && (
          <span
            className={`text-[9px] font-mono rounded px-1 ${
              alert
                ? 'bg-amber-500/20 text-amber-300'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {count > 999 ? '999+' : count}
          </span>
        )}
      </span>
    </TabsTrigger>
  );
}

function StatusBar() {
  const raw = useFirstLight((s) => s.raw);
  const decision = useFirstLight((s) => s.decision);
  const runId = useFirstLight((s) => s.runId);
  const phase = useFirstLight((s) => s.phase);

  const stageTotal = raw?.stages.reduce((a, st) => a + st.ms, 0) ?? 0;
  const blocked = raw?.roads.filter((r) => r.blocked).length ?? 0;

  return (
    <footer className="shrink-0 border-t border-zinc-800/80 bg-zinc-950 px-3 py-1.5 flex items-center gap-3 text-[9px] font-mono text-zinc-600 overflow-x-auto whitespace-nowrap">
      <span className="flex items-center gap-1 text-emerald-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {phase === 'running' ? 'PROCESSING' : 'ONLINE'}
      </span>
      {decision && (
        <>
          <span className="hidden sm:inline">
            {decision.zones.length} H3 zones · {raw?.roads.length ?? 0} road segments ({blocked} blocked)
          </span>
          <span className="hidden md:inline">
            pipeline {(stageTotal / 1000).toFixed(1)}s demo-scaled
          </span>
        </>
      )}
      <span className="flex-1" />
      <span className="hidden lg:inline">{runId}</span>
      <span>FirstLight v2.1 · simulated demo data</span>
      <span className="hidden md:inline">
        © OpenStreetMap contributors · Esri · CARTO
      </span>
    </footer>
  );
}
