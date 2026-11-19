#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
prepare_sources.py - Agora Explorer (C2) - prépare les CSV lus par build_metiers.py

À lancer APRÈS fetch_sources.py (onet + rome) et AVANT build_metiers.py :

  python3 scripts/fetch_sources.py onet
  python3 scripts/fetch_sources.py rome
  python3 scripts/prepare_sources.py --xlsx sources/table-metiers-onet-fr-jobzones.xlsx
  python3 scripts/build_metiers.py --xlsx sources/table-metiers-onet-fr-jobzones.xlsx \
      --sources sources/ --report sources/rapport_nettoyage.txt

Entrées (dossier sources/, ignoré par git) :
  onet/*.csv     base O*NET 31.0 (CSV officiels, licence CC BY 4.0)
  rome/*.csv     ROME 4.0 open data France Travail (licence ouverte Etalab)
  scripts/correspondances/*.csv   décisions manuelles VÉRIFIÉES (versionnées dans git)

Sorties (dans sources/) :
  onet/skills.csv            essential_skills + transferable_skills (O*NET 31 a scindé « Skills »)
  onet/interests.csv         RIASEC au format attendu (3 points hauts) depuis career_interest_types
  rome_crosswalk.csv         onet,rome,statut,source
  rome_contextes.csv         rome,contexte          -> attribut horaires_decales
  missions_competences.csv   onet,type,texte,source -> missions (définition ROME) + compétences
  formations.csv             onet,diplome,duree,source -> conditions d'accès ROME
  titres_override.csv        copie de scripts/correspondances/titres_override.csv

Règle de correspondance O*NET -> ROME (intitulé français du xlsx, sans accents ni casse) :
  1. correspondance manuelle vérifiée (scripts/correspondances/rome_manuel.csv) ;
  2. sinon intitulé égal au titre d'UNE seule fiche ROME ;
  3. sinon égal à UNE seule appellation « PRINCIPALE » ;
  4. sinon égal à des appellations d'UNE seule fiche ;
  5. sinon : pas de code ROME (null), listé dans le rapport. Rien n'est deviné.
"""
import argparse
import csv
import re
import shutil
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

ICI = Path(__file__).resolve().parent
CORRESPONDANCES = ICI / "correspondances"
SOURCE_ROME = "ROME 4.0 – France Travail"
# Le type de correspondance (automatique / vérifiée) est tracé dans le rapport, pas dans la fiche.
SOURCE_ROME_AUTO = SOURCE_ROME
SOURCE_ROME_MANUEL = SOURCE_ROME
MAX_MISSIONS = 5
MAX_SAVOIR_FAIRE = 4
MAX_SAVOIR_ETRE = 3
LETTRES_RIASEC = {"Realistic": "R", "Investigative": "I", "Artistic": "A",
                  "Social": "S", "Enterprising": "E", "Conventional": "C"}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def premier_genre(libelle):
    # « Cuisinier / Cuisinière » -> « Cuisinier »
    # « Acteur / Actrice de complément » -> « Acteur de complément » (le complément vaut pour les deux genres)
    parties = libelle.split(" / ")
    if len(parties) < 2:
        return libelle
    masculin = parties[0].split()
    feminin = parties[1].split()
    return " ".join(masculin + feminin[len(masculin):])


def texte_rome(s):
    # Les CSV ROME doublent les apostrophes : « d''expériences » -> « d'expériences »
    return re.sub(r"\s+", " ", str(s or "").replace("''", "'")).strip()


def lire_csv(chemin):
    with open(chemin, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def ecrire_csv(chemin, entetes, lignes):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    with open(chemin, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(entetes)
        i = 0
        while i < len(lignes):
            w.writerow(lignes[i])
            i += 1
    print("écrit :", chemin, "(%d lignes)" % len(lignes))


def fichier_rome(dossier, nom):
    trouves = sorted(dossier.glob("unix_%s_v*_utf8.csv" % nom))
    if not trouves:
        raise SystemExit("Fichier ROME introuvable : unix_%s_v*_utf8.csv dans %s (lancer fetch_sources.py rome)" % (nom, dossier))
    return trouves[-1]


def lire_xlsx(chemin):
    import openpyxl
    wb = openpyxl.load_workbook(chemin, read_only=True, data_only=True)
    ws = wb["Metiers O-NET Job Zones"] if "Metiers O-NET Job Zones" in wb.sheetnames else wb.worksheets[0]
    lignes = list(ws.iter_rows(values_only=True))
    entetes = [norm(h).replace(" ", "") for h in lignes[0]]
    i_code = entetes.index("onetsoccode")
    i_titre = entetes.index("jobfr")
    metiers = []
    i = 1
    while i < len(lignes):
        r = lignes[i]
        if r and r[i_code] and str(r[i_code]).strip():
            metiers.append((str(r[i_code]).strip(), str(r[i_titre] or "").strip()))
        i += 1
    return metiers


# --------------------------------------------------------------------------- O*NET
def preparer_onet(dossier):
    sortie = []
    noms = ["essential_skills", "transferable_skills", "career_interest_types"]
    i = 0
    while i < len(noms):
        p = dossier / (noms[i] + ".csv")
        if not p.exists():
            raise SystemExit("Fichier O*NET manquant : %s (lancer fetch_sources.py onet)" % p)
        i += 1
    with open(dossier / "essential_skills.csv", encoding="utf-8-sig") as f:
        entete = f.readline()
    with open(dossier / "skills.csv", "w", encoding="utf-8") as out:
        out.write(entete)
        i = 0
        while i < 2:
            with open(dossier / (noms[i] + ".csv"), encoding="utf-8-sig") as f:
                f.readline()
                shutil.copyfileobj(f, out)
            i += 1
    print("écrit :", dossier / "skills.csv")

    # RIASEC : 3 intérêts les plus forts (échelle OI d'O*NET 31) -> format « points hauts » (IH)
    par_code = defaultdict(list)
    lignes = lire_csv(dossier / "career_interest_types.csv")
    i = 0
    while i < len(lignes):
        r = lignes[i]
        lettre = LETTRES_RIASEC.get(r["Element Name"])
        if r["Scale ID"] == "OI" and lettre:
            par_code[r["O*NET-SOC Code"]].append((float(r["Data Value"]), lettre))
        i += 1
    codes = sorted(par_code)
    j = 0
    while j < len(codes):
        code = codes[j]
        valeurs = sorted(par_code[code], key=lambda v: -v[0])
        j += 1
        k = 0
        while k < 3 and k < len(valeurs):
            sortie.append([code, "1.B.1." + "ghi"[k], "IH", "RIASEC".index(valeurs[k][1]) + 1])
            k += 1
    ecrire_csv(dossier / "interests.csv", ["O*NET-SOC Code", "Element ID", "Scale ID", "Data Value"], sortie)


# --------------------------------------------------------------------------- ROME
def index_rome(dossier):
    fiches = lire_csv(fichier_rome(dossier, "referentiel_code_rome"))
    appellations = lire_csv(fichier_rome(dossier, "referentiel_appellation"))
    par_fiche = defaultdict(set)
    par_principale = defaultdict(set)
    par_appellation = defaultdict(set)
    i = 0
    while i < len(fiches):
        par_fiche[norm(premier_genre(fiches[i]["libelle_rome"]))].add(fiches[i]["code_rome"])
        i += 1
    i = 0
    while i < len(appellations):
        a = appellations[i]
        libelles = [a["libelle_appellation_court"], a["libelle_appellation_long"]]
        k = 0
        while k < len(libelles):
            cle = norm(premier_genre(libelles[k]))
            par_appellation[cle].add(a["code_rome"])
            if a["classification"] == "PRINCIPALE":
                par_principale[cle].add(a["code_rome"])
            k += 1
        i += 1
    codes_valides = {f["code_rome"] for f in fiches}
    return par_fiche, par_principale, par_appellation, codes_valides


def correspondance_rome(metiers, dossier_rome, rapport):
    par_fiche, par_principale, par_appellation, codes_valides = index_rome(dossier_rome)
    manuel = {}
    p = CORRESPONDANCES / "rome_manuel.csv"
    if p.exists():
        lignes = lire_csv(p)
        i = 0
        while i < len(lignes):
            r = lignes[i]
            if r["rome"] not in codes_valides:
                rapport.append("MANUEL IGNORÉ : %s -> %s n'existe pas dans ce ROME" % (r["onet"], r["rome"]))
            else:
                manuel[r["onet"]] = r["rome"]
            i += 1
    sortie, compte = [], defaultdict(int)
    i = 0
    while i < len(metiers):
        code, titre = metiers[i]
        cle = norm(titre)
        rome, source = None, SOURCE_ROME_AUTO
        if code in manuel:
            rome, source = manuel[code], SOURCE_ROME_MANUEL
            compte["manuel"] += 1
        else:
            regles = [("titre de fiche", par_fiche), ("appellation principale", par_principale),
                      ("appellation", par_appellation)]
            r = 0
            while r < len(regles):
                regle, index = regles[r]
                candidats = index.get(cle, set())
                if len(candidats) == 1:
                    rome = next(iter(candidats))
                    compte[regle] += 1
                    break
                if len(candidats) > 1:
                    rapport.append("AMBIGU (%s) : %s %s -> %s" % (regle, code, titre, ", ".join(sorted(candidats))))
                    break
                r += 1
        if rome:
            sortie.append([code, rome, "valide", source])
        else:
            compte["sans code"] += 1
        i += 1
    rapport.insert(0, "Correspondance O*NET -> ROME : " + ", ".join("%s=%d" % kv for kv in sorted(compte.items())))
    return sortie


def extraire_rome(crosswalk, dossier, sources):
    roms = {r[1] for r in crosswalk}
    textes = lire_csv(fichier_rome(dossier, "texte"))
    liens = lire_csv(fichier_rome(dossier, "liens_rome_referentiels"))
    contextes = {r["code_ogr"]: r for r in lire_csv(fichier_rome(dossier, "referentiel_contexte_travail"))}
    competences = {r["code_ogr"]: r for r in lire_csv(fichier_rome(dossier, "referentiel_competence"))}

    definitions, acces = defaultdict(list), defaultdict(list)
    i = 0
    while i < len(textes):
        t = textes[i]
        if t["code_rome"] in roms:
            cible = definitions if t["libelle_type_texte"] == "definition" else acces
            cible[t["code_rome"]].append((int(t["position_phrase"] or 0), texte_rome(t["libelle_texte"])))
        i += 1

    ctx_lignes, savoir_faire, savoir_etre = [], defaultdict(list), defaultdict(list)
    i = 0
    while i < len(liens):
        l = liens[i]
        if l["code_rome"] in roms:
            if l["code_ogr"] in contextes:
                ctx_lignes.append([l["code_rome"], texte_rome(contextes[l["code_ogr"]]["libelle_cont_travail"])])
            elif l["code_ogr"] in competences:
                c = competences[l["code_ogr"]]
                lib = texte_rome(c["libelle_competence"])
                if c["cat_comp"] == "Savoir-être professionnel":
                    savoir_etre[l["code_rome"]].append(lib)
                elif c["sous_cat_comp"] == "Technique":
                    savoir_faire[l["code_rome"]].append(lib)
        i += 1
    ecrire_csv(sources / "rome_contextes.csv", ["rome", "contexte"], ctx_lignes)

    mc, formations = [], []
    i = 0
    while i < len(crosswalk):
        onet, rome = crosswalk[i][0], crosswalk[i][1]
        # La 1re phrase de définition est souvent une accroche (« Le Cuisinier, créateur de saveurs… ») :
        # on ne garde comme missions que les phrases qui commencent par un verbe d'action.
        phrases = [p for _, p in sorted(definitions.get(rome, []))]
        missions = [p for p in phrases if not re.match(r"^(Le|La|Les|L'|Il|Elle|Ce|Cet|Cette)\b", p)]
        k = 0
        while k < len(missions) and k < MAX_MISSIONS:
            mc.append([onet, "mission", missions[k].rstrip("."), SOURCE_ROME])
            k += 1
        groupes = [(savoir_etre.get(rome, []), MAX_SAVOIR_ETRE), (savoir_faire.get(rome, []), MAX_SAVOIR_FAIRE)]
        g = 0
        while g < len(groupes):
            liste, maxi = groupes[g]
            k = 0
            while k < len(liste) and k < maxi:
                mc.append([onet, "competence", liste[k], SOURCE_ROME])
                k += 1
            g += 1
        acc = [p for _, p in sorted(acces.get(rome, []))]
        k = 0
        while k < len(acc):
            formations.append([onet, acc[k], "", SOURCE_ROME])
            k += 1
        i += 1
    ecrire_csv(sources / "missions_competences.csv", ["onet", "type", "texte", "source"], mc)
    ecrire_csv(sources / "formations.csv", ["onet", "diplome", "duree", "source"], formations)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--sources", default="sources")
    ap.add_argument("--report", default="sources/rapport_preparation.txt")
    args = ap.parse_args()
    sources = Path(args.sources)

    preparer_onet(sources / "onet")
    metiers = lire_xlsx(args.xlsx)
    rapport = []
    crosswalk = correspondance_rome(metiers, sources / "rome", rapport)
    ecrire_csv(sources / "rome_crosswalk.csv", ["onet", "rome", "statut", "source"], crosswalk)
    extraire_rome(crosswalk, sources / "rome", sources)
    noms = ["titres_override.csv", "attributs_override.csv"]
    i = 0
    while i < len(noms):
        if (CORRESPONDANCES / noms[i]).exists():
            shutil.copy(CORRESPONDANCES / noms[i], sources / noms[i])
            print("copié :", sources / noms[i])
        i += 1
    Path(args.report).write_text("\n".join(rapport) + "\n", encoding="utf-8")
    print(rapport[0])
    print("Rapport :", args.report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
