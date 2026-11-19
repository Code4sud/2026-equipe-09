# Équipe 09 — Hackathon Azuréen #3

Projet réalisé à Nice les 18, 19 et 20 novembre 2026, sur le thème **« L'orientation et l'employabilité grâce à l'IA »**, organisé par [Code4Sud](https://code4sud.fr).

## Le projet

Agora Explorer est un jeu de l'oie en réalité virtuelle, joué assis, qui prolonge
l'entretien avec le psychologue du Centre des Possibles. Le jeune saisit le code de
son profil, répond à des cartes (préférences, situations de travail, découvertes,
passerelles, surprises), puis découvre un classement explicable des métiers de son
champ des possibles et leurs fiches. Aucun métier n'est éliminé.

## Lancer le projet

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Ouvrez <http://localhost:8000/>, passez ou suivez les consignes, saisissez un code
de profil fictif (`4821`, `5137`, `5268`, `5394`, `5412`, `5573`, `6025`, `6148`,
`6291` ou `6370`) puis validez avec **OK**.

Le jeune choisit ensuite son nombre de tours (10, 15, 20 ou 25). Le plateau est une
spirale d'autant de cases autour de lui : départ au bord, arrivée au centre. À chaque
tour, le dé 3D révèle le type de la case suivante et le pion avance d'une case ; la
caméra suit le pion (en VR, le siège se déplace et la tête reste libre). La face
« Centre des Possibles » du dé tire au sort un des cinq types de carte. À la fin, un
podium présente les trois premiers métiers, puis le tableau complet et les fiches.

Paramètres utiles : `?tours=5` (saute le choix, partie de 5 tours), `?brouillon`
(joue aussi les cartes pas encore relues), `?gaze=1` (sélection au regard sur PC).

## Architecture

| Partie | Dossier | Rôle |
| --- | --- | --- |
| Scène VR, accueil, consignes, code (E1) | `src/e1/` | émet `agora-start` et `agora-intro` |
| Moteur de jeu (E2) | `agora-explorer-moteur/` | plateau, dé, cartes, chrono ; tests : `cd agora-explorer-moteur && npm test` |
| Classement (C1) | `js/ranking/` | `ranking.js` + adaptateur vers le moteur |
| Résultats et fiches (E3) | `js/resultats/` | tableau en 3 catégories, fiches en 7 rubriques ; page de test `dev/resultats.html` |
| Assemblage | `js/integration/` | E1 → choix des tours → E2 + C1 → E3, spirale au sol, dé 3D |
| Données (C2, C3) | `data/`, `scripts/` | `metiers.json` généré depuis O*NET et ROME (voir `scripts/README.md`), profils fictifs, cartes |

Les cartes de `data/cases.json` ne sont jouées qu'au statut `relu` (relecture humaine).

### Vérifier sur un casque en HTTPS

Servez la racine de cette branche depuis une prévisualisation statique HTTPS ou
un serveur du réseau local avec un certificat reconnu par le casque. Sur le
réseau local, Python 3.14 ou ultérieur peut servir directement le certificat et
la clé TLS déjà configurés sur la machine.

```bash
python3 -m http.server 8443 --bind 0.0.0.0 \
  --tls-cert /chemin/vers/chaine.pem --tls-key /chemin/vers/cle.pem
```

1. Depuis le navigateur du casque, ouvrez l’adresse HTTPS du serveur avec le
   nom couvert par le certificat. Entrez en VR avec le bouton A-Frame, puis
   recentrez le casque en regardant droit devant vous, en position assise.
2. Vérifiez que la scène suit les mouvements de tête sur 360° et que la cible,
   les consignes et le pavé sont lisibles et accessibles depuis le siège.
3. Vérifiez l’anneau dans les deux yeux, l’annulation en quittant la cible
   avant 1,5 s et l’activation unique lors d’une fixation continue.
4. Démarrez l’intro et validez le profil au regard. Rejouez les consignes,
   vérifiez la reprise de l’écran de jeu, puis quittez et relancez la VR pour
   vérifier le basculement des modes d’entrée.

Le mode `?gaze=1` permet de tester l’interaction sur PC. La session WebXR réelle,
le recentrage, la lisibilité stéréoscopique et le confort restent à vérifier
sur casque avec C3.

## Données et licences

- O*NET 31.0 Database, U.S. Department of Labor, Employment and Training Administration
  (USDOL/ETA), utilisée sous licence CC BY 4.0 ; données modifiées (attributs normalisés).
- ROME 4.0, France Travail, Licence Ouverte / Etalab.
- Police Droid Sans Bold (texte en relief, `assets/fonts/`), Google, licence Apache 2.0.
- Profils et cartes de démonstration fictifs. Aucun Rapport des Possibles réel dans ce dépôt.

## Publier sur le site du hackathon

1. Complétez `projet.json` (nom, pitch, description, écoles, technologies, liens).
2. Ajoutez vos captures dans `captures/` et listez-les dans `projet.json`.
3. Poussez sur `main` : votre fiche apparaît sur https://orientation.code4sud.fr/projets/equipe-09 en moins d'une minute.

Toute la doc : https://orientation.code4sud.fr/doc/

## Démo en ligne

Si votre projet est un site sans serveur, il est publié automatiquement sur GitHub Pages à chaque push :
`https://code4sud.github.io/2026-equipe-09/`. Reportez cette adresse dans le champ `demo` de `projet.json`.

## Licence

MIT — voir `LICENSE`.
