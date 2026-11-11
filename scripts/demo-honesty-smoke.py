#!/usr/bin/env python3
"""FirstLight demo-mode honesty smoke (static build in out/, served locally).

Verifies the acceptance-critical surfaces render in a real browser:
banner, first-use intro, honest map labels, scenario names, scenario-score
wording, ephemeral review note, tabletop route planner, provider registry
(Guide), sr-only tab names on mobile, keyboard-operable swipe divider,
reduced-motion CSS, and zero console errors.

Run: python3 scripts/demo-honesty-smoke.py  (after `bun run build:static`)
"""

import http.server
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "out")
PORT = 8789
PASS, FAIL = 0, 0
console_errors: list[str] = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=OUT, **kw)

    def log_message(self, *a):
        pass


def check(name, cond):
    global PASS, FAIL
    print(f"{'(pass)' if cond else '(FAIL)'} {name}")
    PASS += 1 if cond else 0
    FAIL += 0 if cond else 1


def main():
    t = threading.Thread(target=serve, daemon=True)
    t.start()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/")

        # first-use intro
        page.wait_for_selector("text=Before you begin", timeout=20000)
        check("first-use intro shown", page.locator("text=WHAT IS REAL").count() >= 1 and page.locator("text=WHAT IS GENERATED").count() >= 1)
        check("intro states simulated exercise", page.locator("#fl-intro-title").inner_text().lower().find("simulated exercise") >= 0)
        page.click("text=Start the exercise")
        try:
            page.click("text=Skip", timeout=2500)
        except Exception:
            pass
        page.wait_for_selector("text=GENERATED DATA", timeout=25000)
        page.wait_for_timeout(1500)

        body = page.locator("body").inner_text()
        check("persistent banner: SIMULATED EXERCISE — not current conditions",
              "SIMULATED EXERCISE" in body and "not current conditions" in body)
        check("event selector shows Synthetic Scenario nomenclature",
              page.locator("text=Synthetic Scenario").count() >= 1)
        check("no banned legacy storm names", "Hurricane Odette" not in body and "Cedar River Flood" not in body)
        check("status bar: SIMULATED EXERCISE — no operational use",
              "no operational use" in body)
        check("on-map badge: SIMULATED OVERLAYS", page.locator("text=SIMULATED OVERLAYS").count() == 1)
        check("map pane labels honest (basemap / overlays)",
              page.locator("text=BASEMAP — no scenario overlays").count() == 1
              and page.locator("text=BASEMAP + GENERATED OVERLAYS").count() >= 1)
        check("legend honest (flood extent generated, tabletop route)",
              page.locator("text=Flood extent (generated)").count() == 1
              and page.locator("text=Tabletop route (toy graph)").count() == 1)

        # overview KPI honesty
        page.wait_for_selector("text=GENERATED IMPACT KPIs", timeout=20000)
        ov = page.locator("[role=tabpanel][data-state=active]").inner_text()
        check("KPIs labeled generated (modeled / gen.)", "GENERATED IMPACT KPIs" in ov and "MEAN SCENARIO SCORE" in ov.upper() and "NOT probabilities" in ov)

        # sitrep honesty
        page.click("button:has-text('Sitrep')")
        page.wait_for_timeout(600)
        page.click("button:has-text('Generate sitrep draft')")
        page.wait_for_selector("text=SYNTHETIC EXERCISE REPORT", timeout=15000)
        sv = page.locator("[role=tabpanel][data-state=active]").inner_text()
        check("sitrep: synthetic exercise report", "SYNTHETIC EXERCISE REPORT" in sv)
        check("sitrep: tabletop recommendations", "Hypothetical Tabletop Discussion" in sv)
        check("sitrep: checksum honesty", "non-cryptographic" in sv)

        # review honesty
        page.click("button:has-text('Review')")
        page.wait_for_timeout(500)
        rv = page.locator("[role=tabpanel][data-state=active]").inner_text()
        check("review queue: ephemeral + no training", "browser-memory only" in rv and "no model trains on them" in rv)

        # data panel honesty
        page.click("button:has-text('Data')")
        page.wait_for_timeout(500)
        dv = page.locator("[role=tabpanel][data-state=active]").inner_text()
        check("data: sensor records illustrative", "nothing was acquired" in dv and "NOT ACQUIRED" in dv)
        check("data: population NOT WorldPop", "NOT WorldPop" in dv)
        check("data: review labels ephemeral", "no training path exists" in dv)

        # guide + provider registry
        page.click("button:has-text('Guide')")
        page.wait_for_timeout(700)
        gv = page.locator("[role=tabpanel][data-state=active]").inner_text()
        check("guide: how this demo works", "HOW THIS DEMO WORKS" in gv)
        check("guide: glossary present", "GLOSSARY" in gv and "DSWx" in gv)
        check("guide: provider registry rendered", "Copernicus Data Space" in gv and "NOT LIVE" in gv and "candidate" in gv)
        check("guide: deployment honesty", "No public operational deployment" in gv or "no public operational deployment" in gv)

        # access panel tabletop language
        page.click("button:has-text('Access')")
        page.wait_for_timeout(500)
        av = page.locator("[role=tabpanel][data-state=active]").inner_text()
        check("access: tabletop route planner", "TABLETOP ROUTE PLANNER" in av)
        check("access: not dispatch instructions", "not dispatch instructions" in av)

        # swipe divider keyboard accessibility
        divider = page.locator("[role=slider]")
        check("swipe divider has slider semantics", divider.count() == 1)
        divider.focus()
        val_before = int(divider.get_attribute("aria-valuenow"))
        page.keyboard.press("ArrowRight")
        page.wait_for_timeout(200)
        val_after = int(divider.get_attribute("aria-valuenow"))
        check("swipe divider responds to arrow keys", val_after == min(95, val_before + 3))

        # reduced-motion CSS + focus CSS in served bundle
        css = ""
        for dirpath, _dirnames, filenames in os.walk(os.path.join(OUT, "_next/static")):
            for f in filenames:
                if f.endswith(".css"):
                    css += open(os.path.join(dirpath, f), encoding="utf8").read()
        check("prefers-reduced-motion honored in CSS", "prefers-reduced-motion" in css)
        check(":focus-visible ring in CSS", ":focus-visible" in css)

        page.close()

        # mobile: sr-only tab labels
        m = browser.new_page(viewport={"width": 390, "height": 844})
        m.goto(f"http://127.0.0.1:{PORT}/")
        try:
            m.click("text=Start the exercise", timeout=6000)
        except Exception:
            pass
        try:
            m.click("text=Skip", timeout=3000)
        except Exception:
            pass
        m.wait_for_selector("text=GENERATED DATA", timeout=25000)
        m.wait_for_timeout(1000)
        tabs = m.locator("button[role=tab]")
        sr_only = m.locator("button[role=tab] .sr-only")
        check("mobile: 8 tabs rendered", tabs.count() == 8)
        check("mobile: sr-only tab labels present", sr_only.count() >= 8)
        m.close()
        browser.close()

    print(f"\n{PASS} pass / {FAIL} fail; console errors: {len(console_errors)}")
    for e in console_errors[:5]:
        print("  console:", e[:140])
    raise SystemExit(1 if FAIL or console_errors else 0)


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
