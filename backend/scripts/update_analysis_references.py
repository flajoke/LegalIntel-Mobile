"""Refresh offline analysis references from their publishers, never during a user request.

Run from backend: python scripts/update_analysis_references.py --through YYYY-MM-DD
All pinned normative paragraphs must still occur in the publisher's current text.
This technical comparison does not replace legal review of the rules.
"""
import argparse
from datetime import date
from decimal import Decimal
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
NORM_IDS = {"tk-136", "tk-140", "tk-142", "tk-236", "tk-392", "tk-16", "tk-19.1", "tk-67", "tk-62", "tk-352", "tk-356"}


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.paragraphs, self.row, self.cell, self.paragraph = [], [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "tr": self.row = []
        if tag in {"td", "th"} and self.row is not None: self.cell = ""
        if tag == "p": self.paragraph = ""

    def handle_data(self, data):
        if self.cell is not None: self.cell += data
        if self.paragraph is not None: self.paragraph += data

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self.cell is not None:
            self.row.append(self.cell)
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        if tag == "p" and self.paragraph is not None:
            self.paragraphs.append(self.paragraph)
            self.paragraph = None


def fetch(url):
    with urlopen(url, timeout=30) as response:
        raw = response.read(5_000_001)
    if len(raw) > 5_000_000: raise ValueError("Reference page too large")
    try: text = raw.decode("utf-8")
    except UnicodeDecodeError: text = raw.decode("cp1251")
    page = Page()
    page.feed(text)
    return page, sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--through", required=True, type=date.fromisoformat)
    args = parser.parse_args()
    # The rule edition and calendar are deliberately bounded, not extrapolated.
    if args.through.year != 2026: raise ValueError("Review rule/calendar support before adding another year")
    manifest = json.loads((ROOT / "knowledge/manifest.json").read_text(encoding="utf-8-sig"))
    norms = {}
    compact = lambda text: " ".join(text.split()).replace("ё", "е")
    for item in manifest["documents"]:
        if item["id"] not in NORM_IDS: continue
        page, raw_hash = fetch(item["source_url"])
        current = compact(" ".join(page.paragraphs))
        local = (ROOT / "knowledge" / item["file"]).read_text(encoding="utf-8-sig").strip()
        if sha256(local.encode()).hexdigest() != item["sha256"]:
            raise ValueError("Local normative hash changed: " + item["id"])
        if not all(compact(p) in current for p in local.split("\n\n") if p.strip()):
            raise ValueError("Review changed normative text: " + item["id"])
        norms[item["id"]] = {"sha256": item["sha256"], "source_url": item["source_url"], "page_sha256": raw_hash}
        print("Verified text:", item["id"], flush=True)
    if set(norms) != NORM_IDS: raise ValueError("Missing required normative documents")
    url = "https://www.cbr.ru/hd_base/KeyRate/?UniDbQuery.Posted=True&UniDbQuery.From=01.12.2025&UniDbQuery.To=" + args.through.strftime("%d.%m.%Y")
    page, raw_hash = fetch(url)
    values = {}
    for row in page.rows:
        if len(row) != 2: continue
        try: day = date.fromisoformat("-".join(row[0].strip().split(".")[::-1]))
        except ValueError: continue
        rate = row[1].strip().replace(",", ".")
        if not Decimal(0) <= Decimal(rate) <= Decimal(1000):
            raise ValueError("Unexpected key rate")
        values[day] = rate
    ordered = sorted(values.items())
    if not ordered or ordered[0][0] > date(2026, 1, 1) or ordered[-1][0] != args.through:
        raise ValueError("CBR response does not cover the requested interval")
    periods = []
    for day, rate in ordered:
        if not periods or periods[-1]["percent"] != rate:
            periods.append({"from": day.isoformat(), "percent": rate})
    result = {
        "version": "salary-rules-2026-v1", "valid_from": "2026-01-01", "checked_through": args.through.isoformat(),
        "legal_reviewed": False, "norms": norms,
        "rates": {"source_url": url, "page_sha256": raw_hash, "valid_from": "2026-01-01", "valid_through": args.through.isoformat(), "periods": periods},
        "calendar": {"source_url": "https://www.cbr.ru/other/holidays/", "checked_on": args.through.isoformat(),
            "years": {
                "2025": {"extra_days_off": ["05-02", "05-08", "06-13", "11-03", "12-31"], "extra_workdays": ["11-01"]},
                "2026": {"extra_days_off": ["01-09", "03-09", "05-11", "12-31"], "extra_workdays": []}
            }}
    }
    target = ROOT / "app/domain/rules/reference_data.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Wrote", target, "rate periods:", len(periods))


if __name__ == "__main__": main()
