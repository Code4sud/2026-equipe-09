// Assemblage du produit : scène et accueil (E1) -> partie (E2 + ranking C1) -> résultats (E3).
//
//   E1 émet « agora-start » { profile } quand le code à 4 chiffres est validé ;
//   le jeune choisit son nombre de tours (10, 15, 20 ou 25) ;
//   E2 joue la partie sur une spirale d'autant de cases : à chaque tour, le dé animé
//   révèle le type de la case suivante et le pion avance d'une case, du bord vers le centre.
//   La caméra suit le pion (rig déplacé, tête libre en VR). Face « Centre des Possibles » du dé :
//   un type est tiré au hasard puis joué normalement ;
//   C1 classe les métiers pendant la partie (js/ranking/adaptateur.js) ;
//   E3 écoute « partie-terminee » { profil, classement } et affiche tableau + fiches.
//
// Paramètres d'URL utiles pour tester :
//   ?tours=5       saute le choix et joue 5 tours
//   ?des=preference,centre:situation   impose les premiers lancers (démo : face, ou centre:type tiré)
//   ?brouillon     joue aussi les cases au statut « genere » (pas encore relues)
//   ?gaze=1        curseur au regard sur ordinateur (géré par E1)

import { createGame, CASE_TYPES } from '../../agora-explorer-moteur/engine/game.js';
import { attachVrUI } from '../../agora-explorer-moteur/ui/vrUI.js';
import { creerRankingC1 } from '../ranking/adaptateur.js';
import { creerPlateau } from './plateau.js';
import { creerDe, FACES, DUREE_CENTRE } from './de.js';
import { attacherPanneaux, placerPresDuJoueur, suivreLePion } from './camera.js';
import { poserDecor } from './decor.js';
import { creerTexte3D, chargerPolice } from './texte3d.js';
import { utiliserTexte3D } from '../resultats/canvas-panneau.js';
import { alignerReticule } from './reticule.js';
import { choisirNombreDeTours } from './choixTours.js';
import { monterResultats } from '../resultats/resultats.js';

const params = new URLSearchParams(location.search);
const scene = document.querySelector('#agora-scene');
const TYPES_JOUABLES = ['preference', 'situation', 'passerelle', 'decouverte', 'surprise'];

// Le sol et le disque de E1 sont dessinés en premier et n'écrivent pas la profondeur :
// sinon le disque masquait le bas des réponses, le plateau et « Revoir les consignes ».
function solEnArrierePlan() {
  const couches = [['#sol', -2], ['#disque-sol', -1]];
  let i = 0;
  while (i < couches.length) {
    const el = scene.querySelector(couches[i][0]);
    const mesh = el && el.getObject3D('mesh');
    if (mesh) {
      mesh.renderOrder = couches[i][1];
      mesh.material.depthWrite = false;
    }
    i++;
  }
}

// Résultats des lancers de dé, tirés au début de la partie (le joueur les découvre un par un).
// { face, type } : face montrée par le dé ; type de la case. Face « centre » : type tiré
// au hasard parmi les 5 types jouables, appliqué une seule fois (une case, une carte).
// Règles : 1er tour = préférence (prise en main), pas deux fois de suite la même face.
// Lancers imposés par ?des= (démonstration) : « situation » ou « centre:passerelle ».
function lancersImposes() {
  const brut = (params.get('des') || '').split(',');
  const sortie = [];
  let i = 0;
  while (i < brut.length) {
    const [face, tire] = brut[i].trim().split(':');
    if (FACES.indexOf(face) !== -1) {
      const type = face === 'centre' ? (TYPES_JOUABLES.indexOf(tire) !== -1 ? tire : 'situation') : face;
      sortie.push({ face, type });
    }
    i++;
  }
  return sortie;
}

function tirerLancers(nbTours) {
  const hasard = (liste) => liste[Math.floor(Math.random() * liste.length)];
  const imposes = lancersImposes();
  const lancers = [];
  let i = 0;
  while (i < nbTours) {
    if (i < imposes.length) {
      lancers.push(imposes[i]);
      i++;
      continue;
    }
    let face = i === 0 ? 'preference' : hasard(FACES);
    let essais = 0;
    while (i > 0 && essais < 50 && face === lancers[i - 1].face) {
      face = hasard(FACES);
      essais++;
    }
    lancers.push({ face, type: face === 'centre' ? hasard(TYPES_JOUABLES) : face });
    i++;
  }
  return lancers;
}

// Sans ranking.js, on garde un classement neutre : l'ordre de l'entretien, tout « à explorer ».
function classementDeRepli(profil) {
  const ordre = [];
  const listes = [profil.classement_entretien || [], (profil.champ_des_possibles || []).map((c) => c.onet)];
  let l = 0;
  while (l < listes.length) {
    let i = 0;
    while (i < listes[l].length) {
      if (ordre.indexOf(listes[l][i]) === -1) ordre.push(listes[l][i]);
      i++;
    }
    l++;
  }
  const sortie = [];
  let i = 0;
  while (i < ordre.length) {
    sortie.push({ onet: ordre[i], rang: i + 1, categorie: 'a_explorer', raisons: [] });
    i++;
  }
  return sortie;
}

// Libellés en relief pour les boutons des résultats, du choix des tours et du moteur.
const fabriqueTexte3D = (texte, o) => creerTexte3D({ texte, taille: o.taille || 0.05, largeurMax: o.largeur, lignesMax: 2 });

// Boutons de E1 (pavé numérique, consignes…) : libellé canvas remplacé par du texte en relief.
// Le bouton « Tester la sélection » garde son libellé canvas (il change à chaque essai).
function relieferBoutonsE1() {
  const cibles = scene.querySelectorAll('#e1-ui [agora-target]');
  let i = 0;
  while (i < cibles.length) {
    const cible = cibles[i];
    i++;
    if (cible.id === 'demo-target') continue;
    const legende = cible.querySelector('[agora-label]');
    if (!legende) continue;
    const valeur = legende.getAttribute('agora-label').value;
    const pave = cible.id.indexOf('e1-key-') === 0;
    const largeur = Number(cible.getAttribute('agora-surface')?.width) || 0.8;
    const texte = creerTexte3D({
      texte: valeur, taille: pave ? 0.1 : 0.056, largeurMax: largeur - 0.06, lignesMax: 1,
      couleur: '#FCF9FF', couleurFlanc: '#6A5FB8'
    });
    texte.setAttribute('position', '0 0 0.006');
    legende.setAttribute('visible', false);
    cible.appendChild(texte);
  }
}

function demarrer() {
  solEnArrierePlan();
  utiliserTexte3D(fabriqueTexte3D);
  alignerReticule(scene);
  chargerPolice().then(relieferBoutonsE1).catch((e) => console.warn('[agora] police 3D :', e));
  poserDecor(scene);
  // Les panneaux de E1 et des résultats suivent le joueur quand la caméra suit le pion.
  attacherPanneaux(scene, ['#board-root', '#e1-ui'], { jeu: true });
  attacherPanneaux(scene, ['#results-root']);
  if (!globalThis.RankingModule) console.warn('[agora] ranking.js absent : classement neutre en fin de partie.');

  monterResultats(scene, {
    parent: scene.querySelector('#results-root'),
    position: '0 0.05 2.2', // #results-root est à (0 1,25 -2,2) : on se recentre sur le joueur
    metiersUrl: 'data/metiers.json'
  });

  const zoneJeu = scene.querySelector('#game-content');
  const ancrageUI = scene.querySelector('#board-root');
  let partie = null;        // { game, ui, plateau, de, arrets }
  let resultatsAffiches = false;
  let pauseParIntro = false;

  // Résultats : on retire le bandeau « Profil validé » et le bouton « Revoir les consignes »
  // de E1, qui passeraient devant le tableau. Cible vidée = plus visée par le curseur (README de E1).
  function masquerBandeauE1() {
    const e1Jeu = scene.querySelector('#e1-game');
    if (e1Jeu) e1Jeu.setAttribute('visible', false);
    const revoir = scene.querySelector('#e1-replay');
    if (revoir) {
      revoir.setAttribute('visible', false);
      const cibles = revoir.querySelectorAll('[agora-target]');
      let i = 0;
      while (i < cibles.length) {
        cibles[i].setAttribute('agora-target', '');
        i++;
      }
    }
  }

  async function lancerPartie(profil, nbTours) {
    const ranking = globalThis.RankingModule ? creerRankingC1(globalThis.RankingModule) : null;
    // Case 0 = départ (pas de carte), puis une case par tour.
    const lancers = [{ face: 'preference', type: 'pause' }].concat(tirerLancers(nbTours));
    let position = 0;
    const ROLL_MS = 1700;
    const game = createGame({
      dataPath: 'data/',
      ranking,
      acceptedStatuses: params.has('brouillon') ? ['relu', 'genere'] : ['relu'],
      diceFaces: 1,                 // le pion avance d'une case par tour ; le dé 3D montre le type
      rollMs: ROLL_MS,              // durée de l'animation du dé
      durationMs: 6 * 60 * 60 * 1000, // pas de chrono : la partie finit au centre de la spirale
      board: { loop: false, start: 0, cases: lancers.map((l) => l.type) },
      // Attente du moteur : le lancer qui tombe sur le Centre dure plus longtemps (tirage affiché).
      wait: (ms) => new Promise((ok) => {
        const centre = ms === ROLL_MS && lancers[position + 1] && lancers[position + 1].face === 'centre';
        setTimeout(ok, ms + (centre ? DUREE_CENTRE : 0));
      })
    });
    game.on('pawn:moved', ({ to }) => { position = to; });
    window.agoraGame = game;
    window.agoraLancers = lancers; // pour le débogage : faces du dé et types des cases
    game.bridgeToDom(document);

    // Les colonnes décoratives de E1 (rayon 3,8 m) seraient sur le trajet de la caméra :
    // pendant la partie, le décor est assuré par le ciel (decor.js).
    const reperes = scene.querySelector('#landmarks');
    if (reperes) reperes.setAttribute('visible', false);
    const plateau = creerPlateau(scene.querySelector('#plateau-sol'), game);
    const arreterCamera = suivreLePion(scene, game, plateau);
    const de = creerDe(zoneJeu, game, CASE_TYPES, lancers);
    placerPresDuJoueur(de.el, { x: 1.45, y: -0.3, z: -1.75 });

    const arrets = [game.on('game:ended', ({ results }) => {
      if (partie && partie.ui) {
        partie.ui.destroy();
        partie.ui = null;
      }
      de.detruire();
      resultatsAffiches = true;
      masquerBandeauE1();
      const issu = results && results.ranking && Array.isArray(results.ranking.results) ? results.ranking.results : [];
      // 2,5 s sans carte ni bouton : on voit le personnage arrivé au centre, « Arrivée » au-dessus
      // de sa tête. Puis le plateau s'efface (il passerait devant le tableau) et les résultats s'affichent.
      setTimeout(() => {
        scene.querySelector('#plateau-sol').setAttribute('visible', false);
        scene.emit('partie-terminee', { profil, classement: issu.length > 0 ? issu : classementDeRepli(profil) });
      }, 2500);
    })];

    arrets.push(arreterCamera);
    partie = { game, ui: null, plateau, de, arrets };
    const r = await game.initGame(profil.id);
    if (!r.ok) {
      console.error('[agora] partie impossible :', r.code, r.message);
      return;
    }
    partie.ui = attachVrUI(game, ancrageUI, {
      cardOnlyForQuestions: true,
      theme: 'sombre',
      label3D: (texte, o) => creerTexte3D({ texte, taille: o.taille, largeurMax: o.largeur, lignesMax: 2 }),
      hudText: (etat) => 'Tour ' + Math.min(nbTours, Math.max(1, etat.state === 'playing' ? etat.turn + 1 : etat.turn)) + ' / ' + nbTours
    });
    game.startGame();
  }

  scene.addEventListener('agora-start', async (e) => {
    const profil = e.detail.profile;
    const impose = Number(params.get('tours'));
    const nbTours = impose > 0 ? Math.min(40, Math.round(impose)) : await choisirNombreDeTours(ancrageUI);
    lancerPartie(profil, nbTours);
  });

  // Consignes revues pendant la partie : le jeu se met en pause, puis reprend
  // seulement si c'est l'intro qui l'avait arrêté (une pause du joueur est respectée).
  scene.addEventListener('agora-intro', (e) => {
    const game = partie && partie.game;
    if (e.detail.open) {
      pauseParIntro = game ? game.pauseGame().ok === true : false;
    } else if (e.detail.screen === 'game') {
      if (resultatsAffiches) masquerBandeauE1();
      else if (game && pauseParIntro) game.resumeGame();
      pauseParIntro = false;
    }
  });
}

if (scene.hasLoaded) demarrer();
else scene.addEventListener('loaded', demarrer, { once: true });
