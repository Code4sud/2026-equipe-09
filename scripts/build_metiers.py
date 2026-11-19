#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_metiers.py - Agora Explorer (Equipe 09) - C2 Centrale
Genere data/metiers.json depuis le .xlsx O*NET-FR + sources optionnelles.

Usage :
  python3 scripts/build_metiers.py --xlsx sources/table-metiers-onet-fr-jobzones.xlsx
  python3 scripts/build_metiers.py --xlsx ... --draft     # ecrit metiers.draft.json meme si attributs manquants
  python3 scripts/build_metiers.py --xlsx ... --draft --garder-nom   # version jeu : data/metiers.json

  Avant : scripts/fetch_sources.py onet + rome, puis scripts/prepare_sources.py (voir son en-tete).
  Le xlsx, les sources et les rapports restent dans sources/ (ignore par git : notes du Centre).

Sources optionnelles (sources/) - tout est facultatif, absent => null / [] :
  onet/                      fichiers O*NET (Work_Context, Work_Activities, Skills, Knowledge, Interests ; .txt tabule ou .csv)
  rome_crosswalk.csv         onet,rome,statut,source           (seules les lignes statut=valide sont utilisees)
  rome_contextes.csv         rome,contexte                     (contextes de travail ROME -> horaires_decales)
  attributs_override.csv     onet,attribut,valeur,source       (valeur 0-1, prioritaire sur le calcul)
  formations.csv             onet,diplome,duree,source
  carriere.csv               onet,niveau,poste,source          (niveau: debut|confirme|senior)
  missions_competences.csv   onet,type,texte,source            (type: mission|competence)
  salaires.csv               onet,niveau,min,max,unite,zone_geo,remarque,source   (niveau: debut|cinq_ans|senior)
  titres_override.csv        onet,titre                        (desambiguation de titres)

Codes retour : 0 OK | 1 validation echouee (metiers.json NON ecrit) | 2 erreur d'entree
"""
import argparse
import csv
import json
import math
import re
import sys
import unicodedata
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

# --------------------------------------------------------------------------- constantes
ATTRIBUTS = ["exterieur", "travail_equipe", "contact_public", "activite_physique",
             "travail_manuel", "horaires_decales", "creativite", "analyse_chiffres",
             "aide_aux_autres", "technologie", "encadrement", "deplacements"]
NIVEAUX_SALAIRE = ["debut", "cinq_ans", "senior"]
NIVEAUX_CARRIERE = ["debut", "confirme", "senior"]
CLES_RECORD = ["onet", "rome", "titre", "zone", "riasec", "attributs", "description",
               "missions", "competences", "formation", "carriere", "salaires", "sources"]
UNITE_DEFAUT = "brut mensuel"
ZONE_GEO_DEFAUT = "France"

RE_ONET = re.compile(r"^\d{2}-\d{4}\.\d{2}$")
RE_ROME = re.compile(r"^[A-N]\d{4}$")
RE_RIASEC = re.compile(r"^[RIASEC]{1,3}$")

# --- Regle de zone (decision C2 : 1) zone = jobZone US par defaut ; 2) cellule douteuse => null)
RE_ZONE_LEAD = re.compile(r"^\s*zone\s*([1-5])\b(.*)$", re.I | re.S)
RE_ZONE_OU = re.compile(r"^\s*ou\s*[1-5]\b", re.I)              # "Zone 3 ou 4" => ambigu
RE_ZONE_REMARQUE = re.compile(r"appara[iî]t|actuellement|attention", re.I)

# --- Mapping O*NET -> 12 attributs.  (fichier, [alias du nom d'element], echelle)
# CX = Work Context (1-5) ; IM = importance (1-5).  Normalisation (v-1)/4.  "Not Relevant" = Y -> 0.
# Les noms sont verifies a l'execution : tout nom introuvable est liste dans le rapport.
# Chaque liste contient le nom historique ET le nom de la base O*NET 31.0 (elements renommes).
ATTR_MAP = OrderedDict([
    ("exterieur", ("max", [
        ("work_context", ["Outdoors, Exposed to Weather", "Outdoors, Exposed to All Weather Conditions"], "CX"),
        ("work_context", ["Outdoors, Under Cover"], "CX")])),
    ("travail_equipe", ("mean", [
        ("work_context", ["Work With Work Group or Team", "Work With or Contribute to a Work Group or Team"], "CX")])),
    ("contact_public", ("mean", [
        ("work_context", ["Deal With External Customers",
                          "Deal With External Customers or the Public in General"], "CX"),
        ("work_activities", ["Performing for or Working Directly with the Public"], "IM"),
        ("work_context", ["Face-to-Face Discussions", "Face-to-Face Discussions with Individuals and Within Teams"], "CX")])),
    ("activite_physique", ("mean", [
        ("work_activities", ["Performing General Physical Activities"], "IM"),
        ("work_context", ["Spend Time Standing"], "CX"),
        ("work_context", ["Spend Time Walking and Running", "Spend Time Walking or Running"], "CX"),
        ("work_context", ["Spend Time Bending or Twisting Your Body"], "CX")])),
    ("travail_manuel", ("mean", [
        ("work_context", ["Spend Time Using Your Hands to Handle, Control, or Feel Objects, Tools, or Controls"], "CX"),
        ("work_activities", ["Handling and Moving Objects"], "IM"),
        ("work_context", ["Spend Time Making Repetitive Motions"], "CX")])),
    # horaires_decales : pas d'indicateur O*NET fiable -> regle ROME (rome_contextes.csv) ou override
    ("creativite", ("max", [
        ("work_activities", ["Thinking Creatively"], "IM"),
        ("knowledge", ["Fine Arts"], "IM")])),
    ("analyse_chiffres", ("mean", [
        ("work_activities", ["Analyzing Data or Information"], "IM"),
        ("skills", ["Mathematics"], "IM"),
        ("knowledge", ["Mathematics"], "IM")])),
    ("aide_aux_autres", ("mean", [
        ("work_activities", ["Assisting and Caring for Others"], "IM"),
        ("skills", ["Service Orientation"], "IM")])),
    ("technologie", ("mean", [
        ("work_activities", ["Interacting With Computers", "Working with Computers"], "IM"),
        ("knowledge", ["Computers and Electronics"], "IM"),
        ("knowledge", ["Engineering and Technology"], "IM")])),
    ("encadrement", ("mean", [
        ("work_activities", ["Coordinating the Work and Activities of Others"], "IM"),
        ("work_activities", ["Guiding, Directing, and Motivating Subordinates"], "IM"),
        ("work_context", ["Coordinate or Lead Others in Accomplishing Work Activities"], "CX")])),
    ("deplacements", ("max", [   # PROXY : temps en vehicule / conduite d'engins
        ("work_context", ["In an Enclosed Vehicle or Equipment", "In an Enclosed Vehicle or Operate Enclosed Equipment"], "CX"),
        ("work_context", ["In an Open Vehicle or Equipment", "In an Open Vehicle or Operating Equipment"], "CX"),
        ("work_activities", ["Operating Vehicles, Mechanized Devices, or Equipment"], "IM")])),
])
FICHIERS_ONET = {"work_context": {"CX"}, "work_activities": {"IM"}, "skills": {"IM"},
                 "knowledge": {"IM"}, "interests": {"IH"}}

# --- horaires_decales depuis les contextes de travail ROME (regle equipe, a valider) :
# score = (nombre de regles satisfaites) / 3, 0 si le ROME est documente sans aucune des 3 mentions.
HORAIRES_REGLES = [
    re.compile(r"horaires?\s+(irr[eé]guliers?|d[eé]cal[eé]s?|variables?|altern[eé]s?)", re.I),
    re.compile(r"\bnuit\b|nocturne", re.I),
    re.compile(r"week-?end|dimanche|jours?\s+f[eé]ri[eé]s?|astreinte", re.I),
]


# --------------------------------------------------------------------------- utilitaires
def clean_text(s):
    """NFC, NBSP -> espace, espaces horizontaux compactes, bords retires."""
    if s is None:
        return ""
    s = unicodedata.normalize("NFC", str(s)).replace("\xa0", " ").replace(" ", " ")
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    return s.strip()


def norm_header(h):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", str(h or "")).encode("ascii", "ignore").decode().lower())


def parse_num(x):
    if x is None:
        return None
    s = str(x).replace("\xa0", "").replace(" ", "").replace(" ", "").replace(",", ".").strip()
    if s == "":
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return None if (math.isnan(v) or math.isinf(v)) else v


def num_out(v):
    """Entier si valeur entiere (1.0 -> 1), sinon float arrondi a 2 decimales."""
    v = round(float(v), 2)
    return int(v) if v == int(v) else v


def read_csv_rows(path):
    """Lit un CSV optionnel -> liste de dicts (entetes normalisees) ; [] si absent."""
    p = Path(path)
    if not p.exists():
        return []
    with open(p, encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
        f.seek(0)
        delim = ";" if sample.count(";") > sample.count(",") else ","
        rd = csv.reader(f, delimiter=delim)
        try:
            head = [norm_header(h) for h in next(rd)]
        except StopIteration:
            return []
        return [dict(zip(head, [clean_text(c) for c in row])) for row in rd if any(c.strip() for c in row)]


# --------------------------------------------------------------------------- lecture xlsx
def read_xlsx(path, sheet=None):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else (wb["Metiers O-NET Job Zones"] if "Metiers O-NET Job Zones" in wb.sheetnames else wb.worksheets[0])
    it = ws.iter_rows(values_only=True)
    head = [norm_header(h) for h in next(it)]
    need = {"zonereelle": "zone_fr", "onetsoccode": "onet", "joben": "job_en", "jobfr": "titre",
            "descriptionfr": "description", "jobzone": "jobzone", "justificationjobzone": "justification"}
    idx = {need[h]: i for i, h in enumerate(head) if h in need}
    missing = [v for k, v in need.items() if v not in idx and v in ("onet", "titre", "description", "jobzone", "zone_fr")]
    if missing:
        raise SystemExit("Colonnes introuvables dans le xlsx: %s (entetes lues: %s)" % (missing, head[:8]))
    rows, ignorees = [], []
    for n, r in enumerate(it, start=2):
        if r is None or not any(c is not None and str(c).strip() for c in r[:len(head)]):
            continue
        rec = {k: r[i] if i < len(r) else None for k, i in idx.items()}
        rec["_ligne"] = n
        if not clean_text(rec.get("onet")):
            ignorees.append((n, "code O*NET vide"))
            continue
        if re.search(r"\bdoublon\b", clean_text(rec.get("titre")), re.I):
            ignorees.append((n, "%s marque DOUBLON dans le xlsx (%s)" % (clean_text(rec.get("onet")), clean_text(rec.get("titre")))))
            continue
        rows.append(rec)
    return rows, ignorees


# --------------------------------------------------------------------------- zone
def parse_zone_fr(raw):
    """-> (zone|None, statut). Statuts: vide | ok | ok_remarque | ambigu | note_non_exploitable"""
    s = clean_text(raw)
    if s == "":
        return None, "vide"
    m = RE_ZONE_LEAD.match(s)
    if not m:
        return None, "note_non_exploitable"      # ex. "Etrange : ...", "Apparait en zone 4"
    if RE_ZONE_OU.match(m.group(2)):
        return None, "ambigu"                    # ex. "Zone 3 ou 4 (BUT et concours)"
    zone = int(m.group(1))
    return zone, ("ok_remarque" if RE_ZONE_REMARQUE.search(m.group(2)) else "ok")


def parse_jobzone(v):
    n = parse_num(v)
    return int(n) if n is not None and n == int(n) and 1 <= int(n) <= 5 else None


def resolve_zone(zone_fr, jobzone):
    """Regle: zone FR si exploitable ; jobZone US si zone_fr vide ; sinon null (a verifier)."""
    z, statut = parse_zone_fr(zone_fr)
    if statut in ("ok", "ok_remarque"):
        return z, "zone_fr", statut
    if statut == "vide":
        jz = parse_jobzone(jobzone)
        return jz, ("jobzone_us_defaut" if jz is not None else "a_verifier"), statut
    return None, "a_verifier", statut


# --------------------------------------------------------------------------- O*NET
def find_onet_file(d, stem):
    d = Path(d)
    if not d.is_dir():
        return None
    for p in sorted(d.iterdir()):
        if p.suffix.lower() in (".txt", ".csv", ".tsv") and re.sub(r"[^a-z]", "", p.stem.lower()) == stem.replace("_", ""):
            return p
    return None


def load_onet(d):
    """-> tables {fichier: {(onet, element_lower, echelle): score 0-1}}, noms {fichier:set}, riasec {onet: 'RAE'}"""
    tables, noms, riasec_raw = {}, {}, defaultdict(dict)
    for stem, echelles in FICHIERS_ONET.items():
        p = find_onet_file(d, stem)
        if p is None:
            continue
        delim = "," if p.suffix.lower() == ".csv" else "\t"
        t, n = {}, set()
        with open(p, encoding="utf-8-sig", newline="") as f:
            rd = csv.DictReader(f, delimiter=delim)
            rd.fieldnames = [norm_header(h) for h in rd.fieldnames]
            for r in rd:
                sc = (r.get("scaleid") or "").strip()
                if sc not in echelles:
                    continue
                code = (r.get("onetsoccode") or "").strip()
                name = clean_text(r.get("elementname")).lower()
                v = parse_num(r.get("datavalue"))
                if not code or v is None:
                    continue
                if stem == "interests":          # IH : 1.B.1.g/h/i = 1er/2e/3e point haut, valeur 1-6 = R I A S E C
                    rang = (r.get("elementid") or "").strip().split(".")[-1]
                    if rang in ("g", "h", "i") and 1 <= v <= 6:
                        riasec_raw[code][rang] = "RIASEC"[int(v) - 1]
                    continue
                n.add(name)
                nr = (r.get("notrelevant") or "").strip().upper() == "Y"
                t[(code, name, sc)] = 0.0 if nr else min(1.0, max(0.0, (v - 1.0) / 4.0))
        tables[stem], noms[stem] = t, n
    riasec = {c: "".join(d[k] for k in ("g", "h", "i") if k in d) for c, d in riasec_raw.items()}
    return tables, noms, riasec


def compute_attributs(onet, tables):
    out = {}
    for attr, (agg, comps) in ATTR_MAP.items():
        vals = []
        for fichier, aliases, sc in comps:
            t = tables.get(fichier)
            if not t:
                continue
            for a in aliases:
                v = t.get((onet, a.lower(), sc))
                if v is not None:
                    vals.append(v)
                    break
        if vals:
            out[attr] = num_out(max(vals) if agg == "max" else sum(vals) / len(vals))
    return out


def mapping_introuvable(tables, noms):
    res = []
    for attr, (agg, comps) in ATTR_MAP.items():
        for fichier, aliases, sc in comps:
            if fichier not in tables:
                res.append("%s: fichier O*NET '%s' absent" % (attr, fichier))
            elif not any(a.lower() in noms[fichier] for a in aliases):
                res.append("%s: element introuvable dans %s -> %s" % (attr, fichier, aliases))
    return sorted(set(res))


# --------------------------------------------------------------------------- construction
def build(args):
    src = Path(args.sources)
    log = defaultdict(list)                           # sections du rapport
    rows, ignorees = read_xlsx(args.xlsx, args.sheet)
    log["ignorees"] = ignorees

    # --- 1) fusion des doublons de code O*NET : 1er non vide gagne (ordre du fichier), conflits traces
    groupes = OrderedDict()
    for r in rows:
        groupes.setdefault(clean_text(r["onet"]), []).append(r)
    base = {}
    for code, lst in groupes.items():
        m = {}
        for champ in ("zone_fr", "titre", "description", "jobzone", "job_en"):
            vals = [(clean_text(x.get(champ)), x["_ligne"]) for x in lst if clean_text(x.get(champ))]
            m[champ] = vals[0][0] if vals else ""
            if len({v for v, _ in vals}) > 1:
                log["conflits_fusion"].append("%s champ=%s lignes=%s -> garde ligne %d" % (
                    code, champ, [l for _, l in vals], vals[0][1]))
        m["_lignes"] = [x["_ligne"] for x in lst]
        base[code] = m
        if len(lst) > 1:
            log["doublons_code"].append("%s lignes %s -> fusion (1er non vide gagne)" % (code, m["_lignes"]))

    # --- 2) sources optionnelles
    tables, noms, riasec = load_onet(src / "onet")
    log["mapping_introuvable"] = mapping_introuvable(tables, noms) if tables else ["aucun fichier O*NET dans %s" % (src / "onet")]
    titres_ov = {r["onet"]: r["titre"] for r in read_csv_rows(src / "titres_override.csv") if r.get("onet") and r.get("titre")}

    rome_by = {}
    for r in read_csv_rows(src / "rome_crosswalk.csv"):
        if r.get("statut", "").lower() != "valide":
            continue
        o, rm = r.get("onet", ""), r.get("rome", "").upper()
        if not RE_ROME.match(rm):
            log["rome_invalide"].append("%s -> '%s' (format attendu A1234)" % (o, rm))
            continue
        if o in rome_by:
            log["rome_secondaires"].append("%s: %s ignore (garde %s, 1ere ligne valide)" % (o, rm, rome_by[o][0]))
            continue
        rome_by[o] = (rm, r.get("source") or "ROME 4.0")
    ctx_by = defaultdict(list)
    for r in read_csv_rows(src / "rome_contextes.csv"):
        if r.get("rome"):
            ctx_by[r["rome"].upper()].append(r.get("contexte", ""))
    override = defaultdict(dict)
    for r in read_csv_rows(src / "attributs_override.csv"):
        v, a = parse_num(r.get("valeur")), r.get("attribut", "")
        if a not in ATTRIBUTS or v is None or not (0 <= v <= 1) or not r.get("source"):
            log["override_invalide"].append("%s" % r)
            continue
        override[r.get("onet", "")][a] = (num_out(v), r["source"])
    formations = defaultdict(list)
    for r in read_csv_rows(src / "formations.csv"):
        formations[r.get("onet", "")].append(r)
    carr = defaultdict(lambda: defaultdict(list))
    carr_src = defaultdict(set)
    for r in read_csv_rows(src / "carriere.csv"):
        if r.get("niveau") in NIVEAUX_CARRIERE and r.get("poste"):
            carr[r["onet"]][r["niveau"]].append(r["poste"])
            if r.get("source"):
                carr_src[r["onet"]].add(r["source"])
        else:
            log["carriere_ecartee"].append("%s" % r)
    mc = defaultdict(lambda: {"mission": [], "competence": []})
    mc_src = defaultdict(set)
    for r in read_csv_rows(src / "missions_competences.csv"):
        if r.get("type") in ("mission", "competence") and r.get("texte"):
            mc[r["onet"]][r["type"]].append(r["texte"])
            if r.get("source"):
                mc_src[r["onet"]].add(r["source"])
    sal_rows = defaultdict(list)
    for r in read_csv_rows(src / "salaires.csv"):
        sal_rows[r.get("onet", "")].append(r)

    # --- 3) enregistrements
    records, zone_null_ok, stat = [], set(), Counter()
    zone_table = Counter()
    desaccord = 0
    for code in sorted(base):
        b = base[code]
        sources = set()
        zone, zsrc, zstatut = resolve_zone(b["zone_fr"], b["jobzone"])
        zone_table[(b["zone_fr"], zone, zsrc, zstatut)] += 1
        stat["zone:" + zsrc] += 1
        if zsrc == "a_verifier":
            zone_null_ok.add(code)
            log["zone_a_verifier"].append("%s | %s | zone_fr=%r | jobZone=%s" % (code, b["titre"], b["zone_fr"], b["jobzone"]))
        if zstatut == "ok_remarque":
            log["zone_remarque"].append("%s | %s | zone_fr=%r -> zone=%s (remarque a relire)" % (code, b["titre"], b["zone_fr"], zone))
        if zsrc == "zone_fr" and parse_jobzone(b["jobzone"]) not in (None, zone):
            desaccord += 1

        # attributs
        att = compute_attributs(code, tables) if tables else {}
        prov = {a: "onet" for a in att}
        ctxs = ctx_by.get(rome_by[code][0], []) if code in rome_by else []
        if ctxs:   # ROME documente (>=1 contexte de travail) : 0 mention d'horaires atypiques => 0
            hits = sum(1 for rg in HORAIRES_REGLES if any(rg.search(c) for c in ctxs))
            att["horaires_decales"] = num_out(hits / len(HORAIRES_REGLES))
            prov["horaires_decales"] = "ROME 4.0 – France Travail"
        for a, (v, s) in override.get(code, {}).items():
            att[a], prov[a] = v, s
        for a, p in prov.items():
            sources.add({"onet": args.onet_label}.get(p, p))
        for a in ATTRIBUTS:
            stat["attr_ok:" + a] += 1 if a in att else 0
        ric = riasec.get(code) or None
        if ric:
            sources.add(args.onet_label)
        rome = rome_by.get(code)
        if rome:
            sources.add(rome[1])

        # formation
        fl = formations.get(code, [])
        diplomes = [r["diplome"] for r in fl if r.get("diplome")]
        duree = next((r["duree"] for r in fl if r.get("duree")), None)
        fsrc = next((r["source"] for r in fl if r.get("source")), None)
        if fsrc:
            sources.add(fsrc)
        carriere = [{"niveau": n, "postes": carr[code][n]} for n in NIVEAUX_CARRIERE if carr[code].get(n)] if code in carr else []
        sources |= carr_src.get(code, set()) | mc_src.get(code, set())

        # salaires : un niveau n'est rempli que si min ET max numeriques, min<=max, source citee
        sal = OrderedDict([("unite", UNITE_DEFAUT), ("zone_geo", ZONE_GEO_DEFAUT)])
        for n in NIVEAUX_SALAIRE:
            sal[n] = OrderedDict([("min", None), ("max", None)])
        sal_src, remarques, unite_fixee = [], [], False
        for r in sal_rows.get(code, []):
            n, mn, mx = r.get("niveau"), parse_num(r.get("min")), parse_num(r.get("max"))
            motif = None
            if n not in NIVEAUX_SALAIRE:
                motif = "niveau invalide"
            elif mn is None or mx is None:
                motif = "fourchette incomplete"
            elif mn < 0 or mn > mx:
                motif = "min/max incoherents"
            elif not r.get("source"):
                motif = "source manquante"
            elif sal[n]["min"] is not None:
                motif = "niveau deja renseigne"
            if motif:
                log["salaire_ecarte"].append("%s niveau=%s : %s -> null" % (code, n, motif))
                continue
            u, zg = r.get("unite") or UNITE_DEFAUT, r.get("zone_geo") or ZONE_GEO_DEFAUT
            if not unite_fixee:
                sal["unite"], sal["zone_geo"], unite_fixee = u, zg, True
            elif (u, zg) != (sal["unite"], sal["zone_geo"]):
                log["salaire_ecarte"].append("%s niveau=%s : unite/zone differente (%s/%s) -> null" % (code, n, u, zg))
                continue
            sal[n]["min"], sal[n]["max"] = num_out(mn), num_out(mx)
            sal_src.append(r["source"])
            if r.get("remarque"):
                remarques.append(r["remarque"])
        sal["remarque"] = " ; ".join(sorted(set(remarques)))
        sal["source"] = " ; ".join(sorted(set(sal_src)))
        sources |= set(sal_src)

        titre = titres_ov.get(code) or b["titre"]
        rec = OrderedDict([
            ("onet", code), ("rome", rome[0] if rome else None), ("titre", titre), ("zone", zone),
            ("riasec", ric),
            ("attributs", OrderedDict((a, att.get(a)) for a in ATTRIBUTS)),
            ("description", b["description"]),
            ("missions", mc[code]["mission"] if code in mc else []),
            ("competences", mc[code]["competence"] if code in mc else []),
            ("formation", OrderedDict([("diplomes", diplomes), ("duree", duree), ("source", fsrc)])),
            ("carriere", carriere),
            ("salaires", sal),
            ("sources", sorted(sources)),
        ])
        records.append(rec)

    # titres en double (codes distincts) : jamais fusionnes
    par_titre = defaultdict(list)
    for r in records:   # sans casse ni accents : « Responsable Prevention » == « responsable prévention »
        cle = unicodedata.normalize("NFKD", r["titre"]).encode("ascii", "ignore").decode().lower().strip()
        par_titre[cle].append(r["onet"])
    for t, codes in sorted(par_titre.items()):
        if len(codes) > 1:
            log["titres_doublons"].append("%r -> %s : conserves tous (codes O*NET distincts), a differencier via titres_override.csv" % (t, codes))
    log["_zone_table"] = zone_table
    log["_stat"] = stat
    log["_desaccord"] = desaccord
    log["_n_rows"] = len(rows)
    return records, zone_null_ok, log


# --------------------------------------------------------------------------- validation
def is_num01(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and not math.isnan(v) and 0 <= v <= 1


def validate(rec, zone_null_ok, draft=False):
    e = []
    if list(rec.keys()) != CLES_RECORD:
        e.append("cles racine != schema")
    if not RE_ONET.match(str(rec["onet"])):
        e.append("onet invalide")
    if rec["rome"] is not None and not RE_ROME.match(str(rec["rome"])):
        e.append("rome invalide")
    if not isinstance(rec["titre"], str) or not rec["titre"]:
        e.append("titre vide")
    z = rec["zone"]
    if z is None:
        if rec["onet"] not in zone_null_ok:
            e.append("zone null non justifiee")
    elif not (isinstance(z, int) and not isinstance(z, bool) and 1 <= z <= 5):
        e.append("zone doit etre un entier 1-5")
    if rec["riasec"] is not None and not RE_RIASEC.match(str(rec["riasec"])):
        e.append("riasec invalide")
    att = rec["attributs"]
    if list(att.keys()) != ATTRIBUTS:
        e.append("attributs: les 12 cles exactes sont requises")
    for a in ATTRIBUTS:
        v = att.get(a)
        if v is None:
            if not draft:
                e.append("attribut manquant: " + a)
        elif not is_num01(v):
            e.append("attribut hors [0,1]: %s=%r" % (a, v))
    if not isinstance(rec["description"], str) or not rec["description"]:
        e.append("description vide")
    for k in ("missions", "competences"):
        if not (isinstance(rec[k], list) and all(isinstance(x, str) and x for x in rec[k])):
            e.append(k + " doit etre une liste de textes")
    f = rec["formation"]
    if not (isinstance(f["diplomes"], list) and all(isinstance(x, str) and x for x in f["diplomes"])):
        e.append("formation.diplomes invalide")
    if f["diplomes"] and not f["source"]:
        e.append("formation sans source")
    ncar = [c["niveau"] for c in rec["carriere"]]
    if any(c["niveau"] not in NIVEAUX_CARRIERE or not c["postes"] for c in rec["carriere"]) or len(set(ncar)) != len(ncar):
        e.append("carriere invalide")
    s = rec["salaires"]
    if not s["unite"] or not s["zone_geo"]:
        e.append("salaires.unite/zone_geo vides")
    rempli = False
    for n in NIVEAUX_SALAIRE:
        mn, mx = s[n]["min"], s[n]["max"]
        if (mn is None) != (mx is None):
            e.append("salaires.%s incomplet (min/max)" % n)
        elif mn is not None:
            rempli = True
            if not (isinstance(mn, (int, float)) and isinstance(mx, (int, float)) and 0 <= mn <= mx):
                e.append("salaires.%s incoherent" % n)
    if rempli and not s["source"]:
        e.append("salaires renseignes sans source")
    if not isinstance(rec["sources"], list):
        e.append("sources doit etre une liste")
    return e


# --------------------------------------------------------------------------- rapport
def rapport(args, records, log, erreurs, ecrit):
    L = []
    add = L.append
    add("=== RAPPORT build_metiers.py ===")
    add("Entree : %s" % Path(args.xlsx).name)
    add("Lignes de donnees lues : %d | ignorees : %d | metiers (codes O*NET uniques) : %d" % (log["_n_rows"], len(log["ignorees"]), len(records)))
    for n, m in log["ignorees"]:
        add("  ligne %d ignoree : %s" % (n, m))
    add("")
    add("--- DOUBLONS DE CODE O*NET (regle : fusion, 1er non vide gagne dans l'ordre du fichier) ---")
    add("%d doublon(s)" % len(log["doublons_code"]))
    L.extend("  " + x for x in log["doublons_code"])
    L.extend("  CONFLIT " + x for x in log["conflits_fusion"])
    add("")
    add("--- TITRES FR EN DOUBLE (regle : jamais fusionnes si codes O*NET distincts ; a differencier) ---")
    add("%d titre(s) en double" % len(log["titres_doublons"]))
    L.extend("  " + x for x in log["titres_doublons"])
    add("")
    add("--- ZONE (regle : zone_fr exploitable > jobZone US si zone_fr vide > null 'a verifier') ---")
    st = log["_stat"]
    for k in ("zone:zone_fr", "zone:jobzone_us_defaut", "zone:a_verifier"):
        add("  %-26s %d" % (k[5:], st.get(k, 0)))
    add("  desaccords zone_fr vs jobZone US (zone_fr retenue) : %d" % log["_desaccord"])
    add("  Valeurs distinctes de zone_fr non vides -> zone :")
    for (raw, z, zsrc, zst), n in sorted(log["_zone_table"].items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        if raw:
            add("    x%-3d %-62r -> zone=%s [%s]" % (n, raw, z, zst))
    add("  A VERIFIER (zone = null) : %d" % len(log["zone_a_verifier"]))
    L.extend("    " + x for x in log["zone_a_verifier"])
    add("  Retenues avec remarque (a relire) : %d" % len(log["zone_remarque"]))
    L.extend("    " + x for x in log["zone_remarque"])
    add("")
    add("--- COUVERTURE DES ATTRIBUTS (nb de metiers renseignes sur %d) ---" % len(records))
    for a in ATTRIBUTS:
        add("  %-18s %d" % (a, st.get("attr_ok:" + a, 0)))
    add("  riasec renseigne : %d | rome renseigne : %d | formation : %d | carriere : %d | salaires (>=1 niveau) : %d" % (
        sum(1 for r in records if r["riasec"]), sum(1 for r in records if r["rome"]),
        sum(1 for r in records if r["formation"]["diplomes"]), sum(1 for r in records if r["carriere"]),
        sum(1 for r in records if any(r["salaires"][n]["min"] is not None for n in NIVEAUX_SALAIRE))))
    add("  Mapping O*NET non resolu : %d" % len(log["mapping_introuvable"]))
    L.extend("    " + x for x in log["mapping_introuvable"])
    for titre, k in (("ROME invalides", "rome_invalide"), ("ROME secondaires ignores", "rome_secondaires"),
                     ("Overrides d'attributs invalides", "override_invalide"),
                     ("Lignes carriere ecartees", "carriere_ecartee"), ("Salaires ecartes -> null", "salaire_ecarte")):
        if log[k]:
            add("  %s : %d" % (titre, len(log[k])))
            L.extend("    " + x for x in log[k])
    add("")
    add("--- VALIDATION %s ---" % ("(mode draft : attributs manquants tolerés)" if args.draft else "STRICTE"))
    cnt = Counter(m for _, errs in erreurs for m in errs)
    add("Metiers en erreur : %d / %d" % (len(erreurs), len(records)))
    for m, n in sorted(cnt.items()):
        add("  x%-4d %s" % (n, m))
    for code, errs in erreurs[:20]:
        add("    ex. %s : %s" % (code, "; ".join(errs[:3])))
    add("")
    add("RESULTAT : " + ecrit)
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--sheet")
    ap.add_argument("--sources", default="sources")
    ap.add_argument("--out", default="data/metiers.json")
    ap.add_argument("--report", default="sources/rapport_nettoyage.txt")
    ap.add_argument("--onet-label", default="O*NET 31.0 – USDOL/ETA (CC BY 4.0)")
    ap.add_argument("--draft", action="store_true")
    ap.add_argument("--garder-nom", action="store_true",
                    help="avec --draft : ecrire dans --out tel quel (sans suffixe .draft)")
    args = ap.parse_args()

    records, zone_null_ok, log = build(args)
    erreurs = []
    for rec in records:
        errs = validate(rec, zone_null_ok, draft=args.draft)
        if errs:
            erreurs.append((rec["onet"], errs))

    out = Path(args.out)
    if args.draft and not args.garder_nom:
        out = out.with_name(out.stem + ".draft" + out.suffix)
    if erreurs:
        ecrit = "ECHEC - %s non ecrit (%d metiers invalides). Relancer avec --draft pour un brouillon." % (out.name, len(erreurs)) if not args.draft \
            else "ECHEC - erreurs hors attributs, rien ecrit"
        code = 1
    else:
        out.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(records, ensure_ascii=False, indent=2) + "\n"
        out.write_text(payload, encoding="utf-8", newline="\n")
        ecrit = "OK - %s ecrit (%d metiers)%s" % (out, len(records), " [BROUILLON]" if args.draft else "")
        code = 0
    rep = Path(args.report)
    rep.parent.mkdir(parents=True, exist_ok=True)
    rep.write_text(rapport(args, records, log, erreurs, ecrit), encoding="utf-8", newline="\n")
    print(ecrit)
    print("Rapport :", rep)
    return code


if __name__ == "__main__":
    sys.exit(main())
