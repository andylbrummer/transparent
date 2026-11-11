#!/usr/bin/env python3
"""
Checks for app/public/geo/mineral-deposits.json.

References anyone can look up: La Escondida and Chuquicamata are copper
mines in the Atacama of northern Chile; Grasberg is the copper and gold
mine in the highlands of Papua, Indonesia; Kiruna is Sweden's iron-ore
mine north of the Arctic Circle; Olympic Dam in South Australia is worked
for copper and uranium; Muruntau in Uzbekistan is a gold mine; Bayan Obo
in Inner Mongolia is the great rare-earth deposit. The names, countries
and commodities below are the file's own; the checks hold the bake to it.

Usage:
    python3 tools/pipeline/generate_mineral_deposits.py
    python3 tools/pipeline/test_mineral_deposits.py
"""

import json

import generate_mineral_deposits as bake
from fetch_cache import cached_fetch
from generate_geo import OUTPUT_DIR, REPO_ROOT
from geo_test_support import check, finish

data = json.loads((OUTPUT_DIR / "mineral-deposits.json").read_text())
rows = data["deposits"]
source, codes = bake.read(cached_fetch(bake.ZIP_URL, bake.CACHE_NAME))
check(len(source) == 3168, f"the compilation has 3,168 records ({len(source)})")
check(len(rows) == 3161, f"3,161 kept: seven have no position ({len(rows)})")
check(all(len(r) == 7 for r in rows), "each row is [name, country, lat, lon, group, commodities, setting]")
check(data["groups"] == list(bake.GROUPS) and {r[4] for r in rows} == set(bake.GROUPS), "every group is used, and only those")
check(all(-90 <= r[2] <= 90 and -180 <= r[3] <= 180 for r in rows), "every position is on the globe")
check(not any(r[2] == 0 and r[3] == 0 for r in rows), "none at 0 N 0 E")

check(bake.group_of("Au") == "precious" and bake.group_of("Cu") == "base" and bake.group_of("Fe") == "steel", "gold, copper, iron")
check(bake.group_of("Li") == "critical" and bake.group_of("REE") == "critical", "lithium and rare earths are critical metals")
check(bake.group_of("diamond") == "gems" and bake.group_of("lapis lazuli") == "gems", "diamonds and gemstones")
check(bake.group_of("potash") == "industrial" and bake.group_of("phosphate") == "industrial", "potash and phosphate are industrial")


def named(name: str) -> list[list]:
    return [r for r in rows if r[0] == name]


for name, country, group, word in [
    ("La Escondida", "Chile", "base", "Copper"),
    ("Chuquicamata", "Chile", "base", "Copper"),
    ("Grasberg", "Indonesia", "base", "Copper"),
    ("Kiruna", "Sweden", "steel", "Iron"),
    ("Olympic Dam", "Australia", "base", "uranium"),
    ("Muruntau", "Uzbekistan", "precious", "Gold"),
]:
    found = named(name)
    check(len(found) == 1 and found[0][1] == country and found[0][4] == group and word in found[0][5],
          f"{name}: {country}, {group}, worked for {word} ({found})")
bayan = named("Bayan Obo")
check(any("Rare earth" in r[5] for r in bayan), "Bayan Obo is there as a rare-earth deposit")
chile_copper = sum(1 for r in rows if r[1] == "Chile" and r[4] == "base")
check(chile_copper >= 30, f"Chile is copper country ({chile_copper} base-metal deposits)")
check(not any("oil" in r[5].lower().split() or r[5].lower() in ("coal", "petroleum") for r in rows), "no fuels: outside the compilation's scope")

app = (REPO_ROOT / "app/src/layers/mineral-deposits/deposits.ts").read_text()
for name in ["La Escondida", "Grasberg", "Kiruna", "Olympic Dam", "Muruntau", "Bayan Obo", "Chuquicamata", "Carajas"]:
    check(f"'{name}'" in app, f"the app names {name}")
for group in bake.GROUPS:
    check(f"{group}:" in app, f"the app colours the {group} group")

finish()
