#!/usr/bin/env python3
"""FirstLight design screenshots — desktop / tablet / mobile for the key
journeys of the simulated-exercise demo (static build in out/).

Serves out/ on localhost:8788 and captures:
  desktop 1440x900 : first-use intro · map+overview (banner, honest labels)
                     · zones · sitrep · data · guide
  tablet 768x1024  : map + panels
  mobile 390x844   : banner + tabs + map (sr-only labels) · guide

Run: python3 scripts/design-shots.py   (after `bun run build:static`)
"""

import http.server
import os
import socketserver
import threading

from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "out")
PORT = 8788
SHOTS = os.path.join(ROOT, "docs", "screenshots")
os.makedirs(SHOTS, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=OUT, **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()


def wait_for_demo(page, timeout_ms=25000):
    """Wait until the simulated-exercise app has data (status bar shows run id)."""
    page.wait_for_selector("text=SIMULATED EXERCISE", timeout=timeout_ms)
    page.wait_for_selector("text=GENERATED DATA", timeout=timeout_ms)
    # skip the pipeline pacing overlay if it lingers
    try:
        page.click("text=Skip", timeout=3000)
    except Exception:
        pass
    page.wait_for_timeout(1800)


def close_intro(page):
    try:
        page.click("text=Start the exercise", timeout=4000)
    except Exception:
        pass


def main():
    t = threading.Thread(target=serve, daemon=True)
    t.start()

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- desktop ----------
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(f"http://127.0.0.1:{PORT}/")
        page.wait_for_selector("text=Before you begin", timeout=20000)
        page.wait_for_timeout(600)
        page.screenshot(path=f"{SHOTS}/demo-desktop-first-use.png")
        close_intro(page)
        wait_for_demo(page)
        page.screenshot(path=f"{SHOTS}/demo-desktop-overview.png", full_page=False)

        # zones tab (text label visible on desktop)
        page.click("button:has-text('Zones')")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{SHOTS}/demo-desktop-zones.png")

        # sitrep tab
        page.click("button:has-text('Sitrep')")
        page.wait_for_timeout(900)
        page.screenshot(path=f"{SHOTS}/demo-desktop-sitrep.png")

        # data tab
        page.click("button:has-text('Data')")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{SHOTS}/demo-desktop-data.png")

        # guide tab
        page.click("button:has-text('Guide')")
        page.wait_for_timeout(900)
        page.screenshot(path=f"{SHOTS}/demo-desktop-guide.png")

        # swipe comparison on the map (labels honest)
        page.click("button:has-text('Overview')")
        page.wait_for_timeout(400)
        page.screenshot(path=f"{SHOTS}/demo-desktop-map-swipe.png")

        # export tab
        page.click("button:has-text('Export')")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{SHOTS}/demo-desktop-export.png")
        page.close()

        # ---------- tablet ----------
        page = browser.new_page(viewport={"width": 768, "height": 1024})
        page.goto(f"http://127.0.0.1:{PORT}/")
        wait_for_demo(page)
        close_intro(page)
        page.wait_for_timeout(800)
        page.screenshot(path=f"{SHOTS}/demo-tablet-map-panels.png")
        page.close()

        # ---------- mobile ----------
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(f"http://127.0.0.1:{PORT}/")
        wait_for_demo(page)
        close_intro(page)
        page.wait_for_timeout(800)
        page.screenshot(path=f"{SHOTS}/demo-mobile-map.png")
        # guide tab on mobile (icon-only trigger; sr-only label persists)
        page.click("button[role=tab] >> nth=7")  # 8th tab: Guide
        page.wait_for_timeout(800)
        page.screenshot(path=f"{SHOTS}/demo-mobile-guide.png")
        page.close()

        browser.close()

    print(f"wrote {len(os.listdir(SHOTS))} screenshots to docs/screenshots/")


if __name__ == "__main__":
    main()
