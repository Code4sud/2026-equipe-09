# Équipe 09 — Hackathon Azuréen #3

Projet réalisé à Nice les 18, 19 et 20 novembre 2026, sur le thème **« L'orientation et l'employabilité grâce à l'IA »**, organisé par [Code4Sud](https://code4sud.fr).

## Le projet

Agora Explorer propose un parcours d’orientation en réalité virtuelle. Installé
en position assise, le joueur répond à des questions puis découvre des métiers
associés à son parcours.

## Lancer le projet

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Depuis la racine du dépôt, lancez la commande puis ouvrez
<http://localhost:8000/>. La page charge A-Frame 1.8.0 depuis son CDN.

- Sur PC, faites glisser la souris pour regarder autour de vous et cliquez sur
  **Tester la sélection**. Le compteur augmente une fois par activation.
- Avec <http://localhost:8000/?gaze=1>, le centre de la caméra simule le regard.
  Fixez la cible pendant 1,5 s, puis recommencez en quittant la cible à mi-course.
  Maintenir le regard après l’activation doit laisser le compteur inchangé.
- Lancez les consignes et attendez 85 s. Au pavé, essayez `9999`, corrigez la
  saisie avec **Eff.**, puis validez le profil fictif `4821` du dépôt. Au regard,
  détournez brièvement les yeux entre deux sélections d’une même touche.
- Ouvrez **Revoir les consignes** après validation. À la fin, le jeu est de
  nouveau accessible avec le même profil et les mêmes éléments de scène.

L’absence de `data/profils.json` (HTTP 404) active les profils fictifs de démo
`0042` et `1709`. Une autre erreur de chargement ou un fichier invalide affiche
un message d’indisponibilité. Le pavé exige un identifiant de quatre chiffres,
sous forme de chaîne dans le JSON, avec `fictif: true`.

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

### Points d’intégration E2, E3 et C3

- **E2 (Alexandre Bu)** monte le plateau et ses commandes sous `#board-root`.
  **E3 (Guillaume)** monte les résultats et fiches sous `#results-root`.
  Les deux racines partagent la zone centrale en face du siège. La démo E1
  réserve les bords supérieur et inférieur à ses commandes et au statut.
  E2 et E3 pilotent la transition entre leurs écrans et leurs cibles actives.
- Sur la primitive ou l’entité qui porte la géométrie du bouton, ajoutez
  `agora-target="e2:lancer-de"`. Le balisage existant
  `class="agora-interactive" data-action="e2:lancer-de"` fonctionne aussi.
  Maintenez les cibles à moins de 3 m. Pour désactiver une cible masquée,
  videz `agora-target` ou retirez `data-action` du balisage historique,
  afin de la retirer aussi des intersections.
- Écoutez les événements directement sur `#agora-scene` avant que le joueur
  puisse démarrer. Les propriétés ci-dessous sont dans `event.detail`.

| Événement | Données et usage |
| --- | --- |
| `agora-activate` | `{ action, input, target }`. `input` vaut `mouse` ou `gaze`. `target` est l’entité activée. Utilisez un préfixe propre au module pour les actions. |
| `agora-start` | `{ profile }`. Le profil fictif validé est transmis une seule fois au démarrage, avec son identifiant sous forme de chaîne. |
| `agora-intro` | `{ open, replay, screen }`. `open` indique l’ouverture ou la fermeture. `replay` indique une relecture et `screen` vaut `profile` ou `game`, l’écran rendu à la fermeture. Les modules peuvent suspendre leurs minuteries à l’ouverture. |

Pendant les consignes, E1 masque les deux racines et suspend leurs cibles. À la
fermeture, E1 réaffiche les entités existantes avec leur état. Un module peut
aussi proposer son propre bouton portant l’action `e1:replay` dans l’écran de jeu.

**C3 (Alexandre Be)** peut remplacer les titres, textes et pictogrammes Unicode
dans `src/e1/intro-content.js`. La somme des champs `seconds` doit rester égale
à 85. Les titres et les textes transmettent les consignes sans audio.

#### Raccord avec la branche E2

Le moteur E2 accepte le profil `4821` des données communes et prépare un
plateau de 16 cases. Certaines catégories utilisent des cartes génériques
et quatre métiers du profil manquent encore dans `data/metiers.json`.

1. Créer le moteur avec `dataPath: './data/'` et appeler
   `game.initGame(event.detail.profile.id)` sur `agora-start`.
   Le bouton E2 **Commencer la partie** appelle ensuite `game.startGame()`.
2. Monter `attachVrUI` sous `#board-root`, ajuster sa disposition aux commandes
   E1, puis reprendre la construction du plateau et le déplacement du pion
   à partir de `game:ready` et `pawn:step`. L’interface VR E2 actuelle écoute
   `click` sur `.clickable`. Pour le raccord, utiliser `agora-target` sur ses
   boutons et exécuter leurs actions via `agora-activate`. Utiliser le
   curseur de la scène E1 pour les deux modes d’entrée.
3. Sur `agora-intro` en cours de partie, appeler `pauseGame()` à l’ouverture
   et `resumeGame()` à la fermeture uniquement si l’intro a déclenché la pause.
   E3 pourra écouter `game:ended` pour afficher les résultats.

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
