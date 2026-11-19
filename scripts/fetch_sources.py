#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_sources.py - Agora Explorer (C2) - telechargement des sources OFFICIELLES vers sources/
Stdlib uniquement. A lancer depuis un poste avec acces Internet (non teste dans le sandbox de l'assistant).

  python3 fetch_sources.py onet              # base O*NET 31.0 (CSV, CC BY 4.0) -> sources/onet/
  python3 fetch_sources.py rome              # ROME 4.0 open data France Travail (CSV) -> sources/rome/
  python3 fetch_sources.py onisep            # Ideo-Fiches metiers (XML, licence ODbL) -> sources/onisep/
  python3 fetch_sources.py esco              # crosswalk ESCO <-> O*NET (CSV) -> sources/esco_onet.csv
  python3 fetch_sources.py ft-token          # teste l'authentification France Travail (OAuth2)
  python3 fetch_sources.py ft-get <URL>      # GET authentifie, throttle 1 appel/s -> stdout (JSON)

France Travail : creer une application sur francetravail.io, souscrire aux API ROME 4.0 voulues,
puis exporter FT_CLIENT_ID, FT_CLIENT_SECRET, FT_SCOPE (scopes listes sur la page de l'API souscrite).
Les chemins exacts des endpoints ROME 4.0 (Metiers / Competences / Contextes de travail / Fiches metiers)
sont a COPIER depuis le catalogue francetravail.io : ils ne sont pas codes en dur ici (non verifies).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

# sources/ (a la racine du depot) est ignore par git : rien de telecharge n'est publie.
DEST = Path("sources")
URL_ONET = "https://www.onetcenter.org/dl_files/database/db_31_0_csv/%s.csv"
FICHIERS_ONET = ["work_context", "work_activities", "knowledge", "essential_skills",
                 "transferable_skills", "career_interest_types"]
URL_ROME_CSV = "https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/csv"
URL_ONISEP_ZIP = "https://www.data.gouv.fr/api/1/datasets/r/885de858-19f4-4cbd-b861-a1df50baab8d"
URL_ESCO_ONET = "https://esco.ec.europa.eu/system/files/2023-08/ONET_%28Occupations%29_0_updated.csv"
URL_FT_TOKEN = "https://francetravail.io/connexion/oauth2/access_token?realm=%2Fpartenaire"  # a confirmer dans la doc FT
_last_call = [0.0]


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "agora-explorer-c2/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())
    print("telecharge:", dest, dest.stat().st_size, "octets")


def ft_token():
    cid, sec, scope = (os.environ.get(k) for k in ("FT_CLIENT_ID", "FT_CLIENT_SECRET", "FT_SCOPE"))
    if not (cid and sec and scope):
        raise SystemExit("Definir FT_CLIENT_ID, FT_CLIENT_SECRET et FT_SCOPE (jamais dans le depot git).")
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid,
                                   "client_secret": sec, "scope": scope}).encode()
    req = urllib.request.Request(URL_FT_TOKEN, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def ft_get(url, token):
    wait = 1.05 - (time.time() - _last_call[0])      # limite documentee ROME 4.0 : 1 appel/seconde
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    _last_call[0] = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    cmd = argv[1]
    if cmd == "onet":
        for nom in FICHIERS_ONET:
            download(URL_ONET % nom, DEST / "onet" / (nom + ".csv"))
    elif cmd == "rome":
        z = DEST / "rome" / "rome_csv.zip"
        download(URL_ROME_CSV, z)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(DEST / "rome")
        print("extrait dans", DEST / "rome")
    elif cmd == "onisep":
        z = DEST / "onisep" / "ideo_fiches_metiers.zip"
        download(URL_ONISEP_ZIP, z)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(DEST / "onisep")
        print("extrait dans", DEST / "onisep", "- envoyer un extrait du XML a l'assistant pour ecrire le parseur")
    elif cmd == "esco":
        download(URL_ESCO_ONET, DEST / "esco_onet.csv")
    elif cmd == "ft-token":
        print("token OK (longueur %d)" % len(ft_token()))
    elif cmd == "ft-get" and len(argv) == 3:
        print(json.dumps(ft_get(argv[2], ft_token()), ensure_ascii=False, indent=2))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
