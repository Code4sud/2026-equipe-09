# Moteur de jeu Agora Explorer (E2)

Logique complète d'une partie : chargement des JSON, profil, plateau, dé, pion,
cartes et réponses, effets, chrono, pause, fin de partie, pont vers `ranking.js`.

JavaScript sans dépendance, en modules ES, sans étape de build : ça tourne tel
quel en local et sur GitHub Pages. Le moteur ne touche ni au DOM ni à A-Frame.

## Lancer

```bash
npm start      # sert le dossier sur http://localhost:8080/pc.html
npm test       # 39 tests du moteur (Node 18 ou plus récent, rien à installer)
```

Sans Node : `python3 -m http.server 8080`, ou l'extension Live Server de VS Code.
Le jeu doit passer par un serveur web : en `file://`, les modules et `fetch()` sont bloqués.

`pc.html` accepte des paramètres pour tester vite :

| Paramètre | Effet |
|---|---|
| `?profil=4821` | saute la saisie de l'identifiant |
| `?duree=60` | partie de 60 secondes au lieu de 20 minutes |
| `?data=dossier/` | dossier des JSON (par défaut `data/`, sinon `data-test/`) |
| `?ranking=js/ranking.js` | charge le module de C1 (module ES ou script qui pose `window.ranking`) |
| `?ranking=bouchon` | faux module qui montre seulement les appels reçus |

Clavier : `1` à `4` répondre, `D` ou `Espace` lancer le dé, `P` pause.
Le « Banc de test » en bas de page montre l'état du moteur, impose une valeur
de dé, et liste les avertissements sur les données.

## Contenu du dossier

```
engine/               le moteur (aucun DOM)
  game.js             états, déroulement, API publique, événements
  board.js            plateau et déplacements
  dice.js             dé
  questions.js        choix de la carte selon la case et le profil
  dataLoader.js       chargement et validation des JSON
  timer.js            chrono
  rankingAdapter.js   pont vers ranking.js (C1)
  config.js           réglages : plateau, 6 types et couleurs, durées, règles
ui/
  gameUI.js + .css    interface PC (souris, clavier) et banc de test
  vrUI.js             interface VR A-Frame : carte, réponses, dé, chrono
  typography.js       aides de texte communes
pc.html               version PC jouable
vr-demo.html          exemple d'intégration A-Frame (pas la scène de E1)
data-test/            profils, cases et métiers FICTIFS pour tester
tests/                tests automatiques
tools/                serveur local, bouchon de ranking
```

Les vraies données vont dans `data/` à la racine (`profils.json`, `cases.json`,
`metiers.json`). Tant que `data/cases.json` n'existe pas, les pages utilisent `data-test/`.

## Brancher le moteur

```html
<script type="module">
  import { createGame } from './engine/game.js';

  const game = createGame({ dataPath: 'data/', ranking /* module de C1, optionnel */ });
  window.agoraGame = game;      // accessible depuis les composants A-Frame
  game.bridgeToDom(document);   // rejoue chaque événement en événement DOM « agora:... »

  game.on('question:shown', ({ question }) => { /* afficher */ });
  await game.initGame('4821');
  game.startGame();
</script>
```

## API

Chaque action renvoie `{ ok: true, ... }` ou `{ ok: false, code, message }`.
Une action interdite dans l'état courant est refusée, jamais faite à moitié.

| Fonction | Rôle | États autorisés |
|---|---|---|
| `initGame(profileId, { reload })` | charge les JSON, trouve le profil | tous sauf `loading` |
| `startGame()` | démarre la partie et le chrono | `ready` |
| `rollDice(valeur?)` | dé, déplacement, carte ; `valeur` (1 à 6) impose le résultat | `playing` |
| `movePlayer(n)` | déplace le pion sans dé | `playing` |
| `submitAnswer(answerId, questionId?)` | enregistre la réponse | `question` |
| `continueGame()` | ferme une carte informative | `question` |
| `skipQuestion()` | passe la carte, sans effet | `question` |
| `pauseGame()` / `resumeGame()` | pause du jeu et du chrono | en jeu / `paused` |
| `endGame()` | termine et renvoie les résultats | en jeu |
| `resetGame()` | retour à `idle` | tous |
| `setRanking(module)` | branche `ranking.js`, même en cours de partie | tous |

Lecture : `getGameState()`, `getBoard()`, `getCurrentCase()`, `getCurrentQuestion()`,
`getHistory()`, `getProfileSummary()`, `getJob(onet)`, `getResults()`.
Tout ce qui est renvoyé est une copie.

Par rapport aux noms proposés au départ : `getNextQuestion()` est devenu
`getCurrentQuestion()`, car la carte est choisie automatiquement à l'arrivée sur la case.

Codes d'erreur : `INVALID_STATE`, `BUSY`, `CANCELLED`, `PROFILE_ID_INVALID`,
`PROFILE_NOT_FOUND`, `JSON_MISSING`, `JSON_INVALID`, `DATA_INVALID`, `BOARD_INVALID`,
`INVALID_DICE`, `INVALID_STEPS`, `UNKNOWN_ANSWER`, `STALE_QUESTION`,
`NO_ANSWER_EXPECTED`, `ANSWER_REQUIRED`, `SKIP_DISABLED`.

## États

```
idle -> loading -> ready -> playing -> rolling -> moving -> question -> playing ...
           |                   |                               |
           v                   +--------> paused <-------------+   (reprise : état d'avant)
         error
en jeu -> finished (chrono, endGame, dernière case, maxTurns)
partout -> idle (resetGame)
```

## Événements

`game.on(nom, callback)` renvoie une fonction de désabonnement. `game.on('*', (nom, données) => ...)` écoute tout.

| Événement | Quand | Données |
|---|---|---|
| `state:changed` | changement d'état | `{ from, to }` |
| `game:ready` | profil chargé | `{ profile, board, warnings }` |
| `game:started` | partie lancée | `{ durationMs }` |
| `turn:ready` | le joueur peut lancer le dé | `{ turn, position, case }` |
| `dice:rolling` | le dé part (valeur déjà connue) | `{ value, durationMs }` |
| `dice:rolled` | le dé s'arrête | `{ value }` |
| `pawn:moving` | avant le déplacement | `{ from, to, path, stepMs }` |
| `pawn:step` | à chaque case franchie | `{ position, case }` |
| `pawn:moved` | pion arrivé | `{ from, to, lap }` |
| `case:entered` | case activée | `{ case, turn }` |
| `question:shown` | carte à afficher | `{ question, case }` |
| `answer:recorded` | réponse enregistrée | `{ entry, effectsTotal }` |
| `question:closed` | carte fermée (réponse, continuer ou passer) | `{ entry }` |
| `timer:tick` | chaque seconde | `{ remainingMs, durationMs }` |
| `timer:up` | temps écoulé | `{ state }` |
| `game:paused`, `game:resumed` | pause, reprise | `{ resumeTo }`, `{ state }` |
| `game:ended` | fin de partie | `{ results }` |
| `game:error`, `game:warning` | problème bloquant, ou non | `{ code, message }`, `{ message }` |
| `content:exhausted` | toutes les cartes ont été vues une fois | statistiques |
| `action:rejected` | action refusée | `{ action, code, message, state }` |

Une carte (`question`) :

```js
{
  id, type, label, color, textColor, symbol, texte,
  reponses: [{ id, texte, picto }],   // les effets ne sortent jamais vers l'interface
  informative,                         // true : pas de réponse, appeler continueGame()
  metiers: [{ onet, titre }],
  passerelle: { de: { onet, titre }, vers: { onet, titre } } | null,
  generic,                             // true : carte de secours, cases.json n'avait rien pour ce type
  alreadySeen
}
```

## Pour C1 : ranking.js

Le moteur ne calcule aucun score. Il appelle, si elles existent :

```js
ranking.init(metiers, profil)                      // début de chaque partie (copies des données)
ranking.applyAnswer(effets, contexte)              // à chaque réponse ; contexte = { questionId, answerId, type, metiers_cibles }
ranking.getResults()                               // relayé tel quel dans results.ranking.results
ranking.getExplanation()                           // relayé tel quel dans results.ranking.explanation
ranking.selectBestQuestion(candidates, contexte)   // optionnel : renvoie une carte (ou son id) parmi les candidates
```

Ces signatures sont une **hypothèse** : je n'ai pas vu `ranking.js`. S'il diffère,
la traduction se fait à un seul endroit, `engine/rankingAdapter.js`.

Trois façons de brancher : `createGame({ ranking })`, `game.setRanking(module)`,
ou un `window.ranking` global détecté automatiquement.

Garanties : `effets` ne contient que les 12 clés connues, avec des nombres entre
-1 et +1 (une clé mal orthographiée dans `cases.json` est écartée avec un
avertissement, pour ne pas produire de `NaN`). Si une fonction du ranking lève
une erreur, la partie continue et un avertissement est émis.

## Pour E1 : VR

- Sélection d'une réponse : appeler `game.submitAnswer(answerId, questionId)`.
  C'est le seul point d'entrée, quel que soit le périphérique. Le second
  argument refuse un clic tardif sur une ancienne question.
- `ui/vrUI.js` affiche carte, réponses, dé, chrono et pause sur une entité :
  `attachVrUI(game, document.querySelector('#agora-ui'))`. Ses boutons portent
  la classe `clickable` (réglable : `{ clickableClass }`) et écoutent `click`,
  donc le curseur à fusion (anneau de 1,5 s) les valide sans autre code.
  Le texte est dessiné sur canvas : les accents s'affichent.
- Plateau : `game.getBoard()` donne les cases (type, couleur, symbole).
  `pawn:step` arrive à chaque case franchie, espacé de `stepMs`, pour animer le pion.
  `vr-demo.html` montre un exemple en 20 lignes.
- Dé physique en VR : `game.rollDice(valeurLue)`.
- Casque retiré : appeler `game.pauseGame()` (la pause arrête le chrono).

## Pour E3 : résultats et fiches

Écouter `game:ended` (ou appeler `getResults()`) :

```js
{
  profileId, reason,            // 'timer' | 'manual' | 'board_end' | 'max_turns' | 'content_exhausted'
  durationMs, turns, laps,
  history: [{ turn, elapsedMs, dice, caseIndex, caseType, questionId, questionTexte,
              metiers_cibles, answerId, answerTexte, effets, skipped }],
  effectsTotal: { exterieur: 1.5, ... },          // somme des effets par attribut
  ranking: { available, results, explanation }    // sortie de ranking.js, non modifiée
}
```

`game.getJob(onet)` renvoie la fiche d'un métier ; `game.getProfileSummary()` le profil avec les titres des métiers.

## Pour C3 et C2 : données

À chaque chargement, les JSON sont vérifiés et les anomalies listées dans
« Banc de test > Avertissements » : type inconnu, identifiant en double, plus
de 4 réponses, effet hors bornes, attribut inconnu, code O*NET absent de
`metiers.json`, texte de plus de 120 caractères, profil sans `fictif: true`.
Seules les cases au statut `relu` sont jouées (réglable : `acceptedStatuses`).

Volume : à environ 25 secondes par tour (estimation), 20 minutes font à peu
près 48 tours. Sur 20 000 parties simulées avec le plateau par défaut, cela
représente en moyenne 12 préférences, 12 situations, 9 découvertes,
6 passerelles, 6 surprises et 3 pauses ; pour éviter toute répétition dans
9 parties sur 10, compter 15, 15, 12, 9, 9 et 5. En dessous, le moteur repose
les cartes les moins vues, et leurs effets comptent une nouvelle fois.

## Choix faits

1. **Plateau en boucle** par défaut : 16 cases et un dé à 6 faces font un tour
   en 5 lancers, trop court pour 20 minutes. La partie s'arrête au chrono.
   `board: { loop: false }` donne un plateau en ligne dont la dernière case termine la partie.
2. La case de départ est la case 1 ; elle ne se déclenche pas au départ.
3. Carte choisie : jamais vue et compatible avec les métiers du profil, sinon
   jamais vue, sinon la moins vue. Jamais deux fois de suite la même.
   Pour une passerelle, la compatibilité se juge sur `de` et `vers`.
   Les cases surprise et pause ne filtrent pas sur le profil.
4. Chrono à zéro : fin immédiate si le joueur attend de lancer le dé ; sinon le
   tour en cours se termine, la réponse compte, puis la partie se clôt.
5. Pause demandée pendant le lancer ou le déplacement : appliquée à l'arrivée du pion.
6. `profils.json` et `cases.json` sont obligatoires ; sans `metiers.json` la
   partie se joue, sans titres de métiers.
7. Type de case sans contenu : carte de secours informative. Type inconnu sur
   le plateau : case neutre. La partie ne se bloque pas.

Tout se règle dans `engine/config.js` ou en option de `createGame()`.

## Limites connues

- `ranking.js`, la scène de E1 et les vrais JSON n'ont pas été vus : le
  branchement repose sur le format décrit dans le cahier des charges.
- `ui/vrUI.js` et `vr-demo.html` n'ont pas tourné dans A-Frame ni au casque.
  La logique et le rendu des panneaux ont été vérifiés dans Chrome avec un
  faux A-Frame. À valider en premier.
- Pas de saisie de l'identifiant en VR (un pavé numérique appellerait `game.initGame(id)`).
- Les pictos des réponses sont transmis (`picto`) mais non affichés : passer
  `pictoUrl: (nom) => 'chemin/' + nom + '.svg'` à `mountGameUI` quand les images existent.
- Pas de son, animations minimales.
