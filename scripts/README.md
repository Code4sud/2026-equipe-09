# Génération de `data/metiers.json` (C2)

Tout ce qui est téléchargé ou privé reste dans `sources/`, ignoré par git :
le xlsx (il contient des notes du Centre), les bases O*NET et ROME, les rapports.

## Relancer la génération

```bash
pip install openpyxl
python3 scripts/fetch_sources.py onet      # base O*NET 31.0 -> sources/onet/
python3 scripts/fetch_sources.py rome      # ROME 4.0 open data -> sources/rome/
python3 scripts/prepare_sources.py --xlsx sources/table-metiers-onet-fr-jobzones.xlsx
python3 scripts/build_metiers.py --xlsx sources/table-metiers-onet-fr-jobzones.xlsx --draft --garder-nom
```

Rapports à relire : `sources/rapport_preparation.txt` (correspondances O*NET → ROME)
et `sources/rapport_nettoyage.txt` (zones, doublons, couverture).

## D'où vient chaque champ

| Champ | Source |
|---|---|
| `titre`, `description`, `zone` | xlsx de l'équipe (colonne « Zone réelle » prioritaire) |
| 11 attributs sur 12 | O*NET 31.0 (Work Context, Work Activities, Skills, Knowledge) |
| `horaires_decales` | contextes de travail ROME 4.0 (week-end, nuit, horaires décalés) |
| `riasec` | O*NET 31.0 (Career Interest Types, 3 plus forts) |
| `rome`, `missions`, `competences`, `formation.diplomes` | ROME 4.0 – France Travail |
| `carriere`, `salaires`, `formation.duree` | **vides** : aucune source fiable branchée, rien n'est inventé |

## Décisions manuelles (versionnées)

- `correspondances/rome_manuel.csv` : codes ROME vérifiés à la main (métiers des profils).
- `correspondances/titres_override.csv` : titres en double renommés.
- Les lignes du xlsx marquées « DOUBLON » sont exclues.

## Licences et attributions

- O*NET 31.0 Database, U.S. Department of Labor, Employment and Training Administration (USDOL/ETA),
  utilisée sous licence CC BY 4.0. Données modifiées (normalisation 0-1, regroupement en 12 attributs).
- ROME 4.0, France Travail, Licence Ouverte / Etalab.
