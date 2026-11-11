# Data flow — static demo and local pilot

> Companion to `docs/CAPABILITY_MATRIX.md` and `docs/EVIDENCE_LEDGER.md`. The two flows never mix silently: the demo cannot fetch external data, and the pilot labels its synthetic analysis layer.

## Public demo (static GitHub Pages — simulated exercise)

```mermaid
flowchart TD
    subgraph EXTERNAL["EXTERNAL (none in demo mode)"]
        TILES["Basemap tiles: OSM / Esri / CARTO\n(real geography, attribution in map footer)"]
    end

    subgraph BROWSER["Browser — everything else is generated fiction"]
        CATALOG["Synthetic scenario catalog\n(Synthetic Scenario A/B/C · seed)"]
        GEN["Procedural generator\nroads · buildings · damage labels · flood bands ·\nfacilities · population grid · closures"]
        COMPUTE["Real compute on generated data\nH3 res-8 zoning · need scores + uncertainty ·\nsensitivity · Dijkstra on toy graph"]
        REVIEW["Review queue — browser-memory only\n(ephemeral; no persistence; no training path)"]
        SITREP["Synthetic-exercise sitrep\ntabletop language · tool-call citations ·\nFNV-1a demo checksums (not signatures)"]
        EXPORTS["Exports — every artifact stamped\nsimulated:true · scenario_id · seed · warning"]
        UI["UI honesty layer\npersistent banner · first-use intro · Guide/glossary ·\nbasemap-vs-overlays labels · scenario scores"]
    end

    TILES --> UI
    CATALOG --> GEN --> COMPUTE --> REVIEW --> SITREP --> EXPORTS
    COMPUTE --> UI
    GEN --> UI
```

**Key invariants:** no network data fetch other than map tiles; same seed ⇒ identical scenario; nothing is persisted server-side; no ML model exists anywhere in this path.

## Local pilot (runnable, server-backed — real catalog + labeled-synthetic analysis)

```mermaid
flowchart TD
    subgraph SRC["Data sources (server-side adapters only)"]
        USGS["USGS earthquakes\n(metadata)"]
        NWS["NWS alerts"]
        OM["Open-Meteo GloFAS\n(discharge)"]
        STAC["Copernicus STAC\n(catalog discovery)"]
        OSM["OSM Overpass\n(bounded)"]
        BLK["FIRMS / Planet / Maxar / Sentinel-Hub /\nECMWF / Twitter — credential-blocked\n(honest blocker, never faked)"]
    end

    subgraph SERVER["Server (authenticated, RBAC, org-scoped)"]
        ING["Ingestion orchestrator\nretries · backoff · timeouts · SSRF allowlist ·\nchecksums · idempotency"]
        DB[("Postgres/PostGIS or SQLite\norgs · users · sessions · events · asset catalog ·\ningestion runs · review decisions · score configs ·\nsitreps/claims/approvals · exports · offline bundles")]
        AUDIT[("Append-only SHA-256 audit chain")]
        LAYER["Layer builder\nprovenance: analysisMode=synthetic-scenario\n+ catalog asset IDs + caveats"]
        SITSERV["Sitrep + approval freeze\n(two-person rule)"]
    end

    subgraph PY["Python worker"]
        BLOCKED["raster/ML tasks → blocked_scaffold\n(exact missing dependency reported)"]
    end

    subgraph CLIENT["Browser"]
        GATE["login gate"]
        OPUI["operational UI\n⚠ SYNTHETIC ANALYSIS badge beside the layer"]
    end

    USGS --> ING
    NWS --> ING
    OM --> ING
    STAC --> ING
    OSM --> ING
    BLK -. blocked .-> ING
    ING --> DB --> AUDIT
    DB --> LAYER --> OPUI
    DB --> SITSERV
    PY -. reports blockers .-> SERVER
    GATE --> OPUI
```

**Key invariants:** secrets are server-side env only (never in client bundles); the analysis geometry is still the labeled synthetic scenario — the pilot never claims a processed product; the browser renders server-computed layers losslessly and composes nothing itself.

## Proposed next seam (not implemented — do not conflate with the above)

```mermaid
flowchart LR
    A["Copernicus SDS: register →\nauthenticate server-side"] --> B["STAC search AOI+date →\nasset download + checksum + validation"]
    B --> C["Raster pipeline (worker):\nRTC / cloud-mask / compositing"]
    C --> D["Derived product with full lineage:\nsource IDs · algorithm version · masks · quality"]
    D --> E["Human review + calibration study\nbefore any consequential output"]
```

Every step above is a documented owner action in `docs/PROVIDER_STATUS.md`, not an existing capability.
