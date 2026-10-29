/* Contract tests — every adapter against recorded provider payloads.
 * Covers: happy path, malformed payload, provider error, timeout, empty
 * results, SSRF/host-allowlist refusal, validation honesty. All offline via
 * injected fetch fixtures. */

import { describe, expect, test } from 'bun:test';
import { usgsEarthquakeAdapter } from '@/lib/server/adapters/usgs-earthquake';
import { openMeteoFloodAdapter } from '@/lib/server/adapters/open-meteo-flood';
import { nwsAlertsAdapter } from '@/lib/server/adapters/nws-alerts';
import { copernicusStacAdapter } from '@/lib/server/adapters/copernicus-stac';
import { firmsFireAdapter, parseFirmsCsvForTest } from '@/lib/server/adapters/firms-fire';
import { osmOverpassAdapter } from '@/lib/server/adapters/osm-overpass';
import { worldPopAdapter, worldpopIso3ForTest } from '@/lib/server/adapters/worldpop';
import { resilientFetch } from '@/lib/server/adapters/http-client';
import type { AdapterDeps } from '@/lib/server/adapters/types';

const AOI = { lat: 41.977, lng: -91.665, aoiKm: 9 };
const WINDOW = { from: '2025-06-01T00:00:00Z', to: '2025-06-30T00:00:00Z' };

function fixtureFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: string; headers?: Record<string, string> },
): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const r = handler(String(url), init);
    return new Response(r.body, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
}

/* ------------------------------------------------------------- USGS */

describe('USGS earthquake adapter (contract)', () => {
  const usgsPayload = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        id: 'testquake2025abcd',
        properties: {
          mag: 5.1,
          place: '10 km NE of Cedar Rapids, Iowa',
          time: 1750084800000,
          updated: 1750085000000,
          alert: 'green',
          magType: 'ml',
          status: 'reviewed',
          tsunami: 0,
        },
        geometry: { type: 'Point', coordinates: [-91.6, 42.01, 8.4] },
      },
    ],
  });

  test('happy path: discover → validate → normalize with correct metadata', async () => {
    const deps: AdapterDeps = { fetchImpl: fixtureFetch(() => ({ status: 200, body: usgsPayload })) };
    const assets = await usgsEarthquakeAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW },
      deps,
    );
    expect(assets).toHaveLength(1);
    const a = assets[0];
    expect(a.externalId).toBe('usgs:testquake2025abcd');
    expect(a.quality.magnitude).toBe(5.1);
    expect(a.quality.depthKm).toBe(8.4);
    expect(a.geometry?.type).toBe('Point');
    const acquired = await usgsEarthquakeAdapter.acquire(a, { mode: 'reference', maxBytes: 1024 });
    const report = await usgsEarthquakeAdapter.validate(a, acquired);
    expect(report.ok).toBe(true);
    const products = await usgsEarthquakeAdapter.normalize(a, acquired, {
      eventId: 'ev-test',
      orgId: 'org',
    });
    expect(products[0].assetType).toBe('hazard.earthquake');
    expect(products[0].simulated).toBe(false);
    expect(products[0].license).toContain('public domain');
  });

  test('empty feature list → honest empty array', async () => {
    const deps: AdapterDeps = {
      fetchImpl: fixtureFetch(() => ({ status: 200, body: '{"type":"FeatureCollection","features":[]}' })),
    };
    const assets = await usgsEarthquakeAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW },
      deps,
    );
    expect(assets).toHaveLength(0);
  });

  test('malformed payload → error, not silent data', async () => {
    const deps: AdapterDeps = { fetchImpl: fixtureFetch(() => ({ status: 200, body: '{"unexpected":true}' })) };
    await expect(
      usgsEarthquakeAdapter.discover({ eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW }, deps),
    ).rejects.toThrow(/unexpected response shape/i);
  });

  test('provider 404 → permanent upstream error (no retry)', async () => {
    const deps: AdapterDeps = { fetchImpl: fixtureFetch(() => ({ status: 404, body: 'not found' })) };
    await expect(
      usgsEarthquakeAdapter.discover({ eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW }, deps),
    ).rejects.toThrow(/404/);
  });
});

/* ------------------------------------------------------- Open-Meteo flood */

describe('Open-Meteo flood adapter (contract)', () => {
  const floodPayload = JSON.stringify({
    latitude: 41.9375,
    longitude: -91.6875,
    daily: {
      time: ['2025-06-16', '2025-06-17'],
      river_discharge: [112.5, 340.2],
      river_discharge_median: [110, 320],
      river_discharge_max: [120, 380],
      river_discharge_min: [100, 300],
    },
  });

  test('labels the product as forecast-risk, never a flood polygon', async () => {
    const deps: AdapterDeps = { fetchImpl: fixtureFetch(() => ({ status: 200, body: floodPayload })) };
    const assets = await openMeteoFloodAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW },
      deps,
    );
    expect(assets).toHaveLength(1);
    expect(assets[0].assetType).toBe('hazard.flood-forecast');
    expect(assets[0].quality.productClass).toBe('forecast-risk');
    expect(assets[0].quality.peakDischargeM3s).toBe(340.2);
    expect(assets[0].quality.units).toBe('m³/s');
    const report = await openMeteoFloodAdapter.validate(assets[0], { mode: 'reference', sizeBytes: 0, sha256: null });
    expect(report.ok).toBe(true);
  });

  test('no river in grid cell → empty result (not a failure)', async () => {
    const payload = JSON.stringify({
      latitude: 20,
      longitude: 20,
      daily: { time: ['2025-06-16'], river_discharge: [] },
    });
    const deps: AdapterDeps = { fetchImpl: fixtureFetch(() => ({ status: 200, body: payload })) };
    const assets = await openMeteoFloodAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW },
      deps,
    );
    expect(assets).toHaveLength(0);
  });

  test('carries CC BY 4.0 attribution for GloFAS via Open-Meteo', async () => {
    const lic = openMeteoFloodAdapter.license();
    expect(lic.name).toContain('CC BY 4.0');
    expect(lic.attribution).toContain('GloFAS');
  });
});

/* ---------------------------------------------------------- NWS alerts */

describe('NWS alerts adapter (contract)', () => {
  const nwsPayload = JSON.stringify({
    features: [
      {
        id: 'https://api.weather.gov/alerts/1',
        geometry: null,
        properties: {
          event: 'Flood Warning',
          headline: 'Flood Warning issued for Linn County',
          severity: 'Severe',
          certainty: 'Likely',
          urgency: 'Expected',
          areaDesc: 'Linn County, Iowa',
          senderName: 'NWS Cedar Rapids',
          sent: '2025-06-16T10:00:00Z',
          effective: '2025-06-16T10:00:00Z',
          expires: '2025-06-18T10:00:00Z',
          messageType: 'Alert',
        },
      },
    ],
  });

  test('severity/urgency/certainty metadata parsed and validated', async () => {
    const deps: AdapterDeps = { fetchImpl: fixtureFetch(() => ({ status: 200, body: nwsPayload })) };
    const assets = await nwsAlertsAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW },
      deps,
    );
    expect(assets).toHaveLength(1);
    expect(assets[0].quality.severity).toBe('Severe');
    expect(assets[0].quality.issuer).toBe('NWS Cedar Rapids');
    const report = await nwsAlertsAdapter.validate(assets[0], { mode: 'reference', sizeBytes: 0, sha256: null });
    expect(report.ok).toBe(true);
    expect(nwsAlertsAdapter.license().name).toContain('public domain');
  });
});

/* ------------------------------------------------- Copernicus STAC */

describe('Copernicus STAC adapter (contract)', () => {
  const stacPayload = JSON.stringify({
    type: 'FeatureCollection',
    context: { matched: 2, returned: 2 },
    features: [
      {
        id: 'S1A_IW_GRDH_1SDV_20250617T001000',
        collection: 'sentinel-1-grd',
        bbox: [-91.75, 41.93, -91.58, 42.02],
        properties: {
          datetime: '2025-06-17T00:10:00Z',
          created: '2025-06-17T02:00:00Z',
          'processing:baseline': '05.03',
          'sat:orbit_state': 'descending',
          platform: 'S1A',
          'sar:polarizations': ['VV', 'VH'],
        },
        assets: { download: { href: 'https://catalogue.dataspace.copernicus.eu/x' } },
      },
    ],
  });

  test('STAC item discovered with bbox polygon + baseline; normalize keeps status "discovered" (honest)', async () => {
    const deps: AdapterDeps = {
      fetchImpl: fixtureFetch((url) => {
        expect(url).toContain('catalogue.dataspace.copernicus.eu');
        return { status: 200, body: stacPayload };
      }),
    };
    const assets = await copernicusStacAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW },
      deps,
    );
    expect(assets).toHaveLength(1);
    expect(assets[0].geometry?.type).toBe('Polygon');
    expect(assets[0].quality.processingBaseline).toBe('05.03');
    const products = await copernicusStacAdapter.normalize(
      assets[0],
      { mode: 'reference', sizeBytes: 0, sha256: null },
      { eventId: 'ev-test', orgId: 'org' },
    );
    // HONESTY: imagery is a metadata reference, never a processed detection.
    expect(products[0].status).toBe('discovered');
  });

  test('license snapshot records free & open terms with attribution template', () => {
    const lic = copernicusStacAdapter.license();
    expect(lic.name).toContain('free & open');
    expect(lic.attribution).toContain('Copernicus Sentinel data');
  });
});

/* ---------------------------------------------------------- FIRMS (blocked) */

describe('NASA FIRMS adapter (blocked dependency)', () => {
  test('refuses to discover without FIRSTLIGHT_FIRMS_TOKEN (no fabrication)', async () => {
    const prev = process.env.FIRSTLIGHT_FIRMS_TOKEN;
    delete process.env.FIRSTLIGHT_FIRMS_TOKEN;
    try {
      await expect(
        firmsFireAdapter.discover({ eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW }),
      ).rejects.toThrow(/BlockedDependencyError|FIRSTLIGHT_FIRMS_TOKEN/);
    } finally {
      if (prev) process.env.FIRSTLIGHT_FIRMS_TOKEN = prev;
    }
  });

  test('health reports blocked with an explicit note', () => {
    expect(firmsFireAdapter.health).toBe('blocked');
    expect(firmsFireAdapter.healthNote).toContain('FIRSTLIGHT_FIRMS_TOKEN');
  });

  test('CSV parser handles the documented FIRMS format', () => {
    const csv = [
      'latitude,longitude,bright_ti31,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight',
      '41.98,-91.66,301.2,2025-06-17,0230,VIIRS SNPP,VIIRS,n,2.0N,301.2,12.4,N',
      '41.99,-91.67,300.1,2025-06-17,0230,VIIRS SNPP,VIIRS,l,2.0N,300.1,8.1,N',
    ].join('\n');
    const rows = parseFirmsCsvForTest(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].latitude).toBe(41.98);
    expect(rows[0].confidence).toBe('n');
    expect(rows[0].dayNight).toBe('N');
    expect(rows[1].frp).toBe(8.1);
  });
});

/* ---------------------------------------------------------- OSM Overpass */

describe('OSM Overpass adapter (contract)', () => {
  const overpassPayload = JSON.stringify({
    elements: [
      {
        type: 'node',
        id: 123456,
        lat: 41.976,
        lon: -91.665,
        tags: { amenity: 'hospital', name: 'St. Luke\'s Test Hospital' },
      },
      {
        type: 'way',
        id: 987654,
        center: { lat: 41.98, lon: -91.66 },
        tags: { highway: 'primary', surface: 'asphalt', maxspeed: '50' },
      },
      { type: 'node', id: 1, lat: 41.0, lon: -91.0 }, // no tags → skipped
    ],
  });

  test('facilities + roads classified; untagged elements skipped; status stays UNKNOWN', async () => {
    const deps: AdapterDeps = {
      fetchImpl: fixtureFetch((_url, init) => {
        expect(String(init?.body)).toContain('data='); // Overpass query form body
        return { status: 200, body: overpassPayload };
      }),
    };
    const assets = await osmOverpassAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW },
      deps,
    );
    expect(assets).toHaveLength(2);
    const hospital = assets.find((a) => a.assetType === 'roads.facility');
    expect(hospital?.quality.facilityType).toBe('hospital');
    expect(hospital?.quality.operationalStatus).toBe('unknown'); // NEVER 'operational'
    const road = assets.find((a) => a.assetType === 'roads.osm');
    expect(road?.quality.highwayClass).toBe('primary');
    const report = await osmOverpassAdapter.validate(hospital!, { mode: 'reference', sizeBytes: 0, sha256: null });
    expect(report.ok).toBe(true);
    expect(osmOverpassAdapter.license().name).toContain('ODbL');
  });

  test('AOI over the pilot cap is rejected politely', async () => {
    await expect(
      osmOverpassAdapter.discover(
        { eventId: 'ev-test', aoi: { lat: 0, lng: 0, aoiKm: 30 }, timeWindow: WINDOW },
        {},
      ),
    ).rejects.toThrow(/pilot cap/i);
  });
});

/* ---------------------------------------------------------- WorldPop */

describe('WorldPop adapter (contract)', () => {
  test('USA event → correct dataset reference with year/resolution/license', async () => {
    const assets = await worldPopAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW, params: { country: 'United States' } },
    );
    expect(assets).toHaveLength(1);
    expect(assets[0].quality.iso3).toBe('USA');
    expect(assets[0].quality.datasetYear).toBe(2020);
    expect(assets[0].quality.productClass).toBe('catalog-reference');
    const report = await worldPopAdapter.validate(assets[0], { mode: 'reference', sizeBytes: 0, sha256: null });
    expect(report.ok).toBe(true);
  });

  test('unknown country → empty (never a guessed dataset)', async () => {
    const assets = await worldPopAdapter.discover(
      { eventId: 'ev-test', aoi: AOI, timeWindow: WINDOW, params: { country: 'Atlantis' } },
    );
    expect(assets).toHaveLength(0);
  });

  test('iso3 mapping', () => {
    expect(worldpopIso3ForTest('United States')).toBe('USA');
    expect(worldpopIso3ForTest('Türkiye')).toBe('TUR');
    expect(worldpopIso3ForTest('Kenya')).toBe('KEN');
    expect(worldpopIso3ForTest('Atlantis')).toBe('UNKNOWN');
  });
});

/* ------------------------------------------------- resilientFetch hardening */

describe('resilientFetch (cross-cutting rules)', () => {
  test('SSRF guard: host outside the allowlist is refused', async () => {
    await expect(
      resilientFetch('https://evil.example.com/data', { allowedHosts: ['good.example.com'] }),
    ).rejects.toThrow(/allowlist/i);
  });

  test('non-HTTPS upstream is refused', async () => {
    await expect(
      resilientFetch('http://good.example.com/data', { allowedHosts: ['good.example.com'] }),
    ).rejects.toThrow(/non-HTTPS/i);
  });

  test('oversized declared content-length is refused without reading', async () => {
    const fetchImpl = fixtureFetch(() => ({
      status: 200,
      body: 'x',
      headers: { 'content-length': String(999 * 1024 * 1024) },
    }));
    await expect(
      resilientFetch('https://good.example.com/big', {
        allowedHosts: ['good.example.com'],
        maxBytes: 1024,
        fetchImpl,
      }),
    ).rejects.toThrow(/exceeds/i);
  });

  test('wrong content-type is refused', async () => {
    const fetchImpl = fixtureFetch(() => ({
      status: 200,
      body: '<html>hi</html>',
      headers: { 'content-type': 'text/html' },
    }));
    await expect(
      resilientFetch('https://good.example.com/x', {
        allowedHosts: ['good.example.com'],
        expectedContentType: 'json',
        fetchImpl,
        retries: 0,
      }),
    ).rejects.toThrow(/content-type/i);
  });

  test('retries on 500 then succeeds', async () => {
    let calls = 0;
    const fetchImpl = fixtureFetch(() => {
      calls++;
      if (calls === 1) return { status: 500, body: 'oops' };
      return { status: 200, body: '{"ok":true}' };
    });
    const res = await resilientFetch('https://good.example.com/flaky', {
      allowedHosts: ['good.example.com'],
      retries: 2,
      fetchImpl,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test('timeout surfaces as a retryable upstream error', async () => {
    const fetchImpl = (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    await expect(
      resilientFetch('https://good.example.com/slow', {
        allowedHosts: ['good.example.com'],
        retries: 1,
        fetchImpl,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timeout/i);
  });
});
