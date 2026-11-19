// Assemblage du produit : scène et accueil (E1) -> partie (E2 + ranking C1) -> résultats (E3).
//
//   E1 émet « agora-start » { profile } quand le code à 4 chiffres est validé ;
//   le jeune choisit son nombre de tours (10, 15, 20 ou 25) ;
//   E2 joue la partie sur une spirale d'autant de cases : à chaque tour, le dé animé
//   révèle le type de la case suivante et le pion avance d'une case, du bord vers le centre ;
//   C1 classe les métiers pendant la partie (js/ranking/adaptateur.js) ;
//   E3 écoute « partie-terminee » { profil, classement } et affiche tableau + fiches.
//
// Paramètres d'URL utiles pour tester :
//   ?tours=5       saute le choix et joue 5 tours
//   ?brouillon     joue aussi les cases au statut « genere » (pas encore relues)
//   ?gaze=1        curseur au regard sur ordinateur (géré par E1)

import { createGame, CASE_TYPES } from '../../agora-explorer-moteur/engine/game.js';
import { attachVrUI } from '../../agora-explorer-moteur/ui/vrUI.js';
import { creerRankingC1 } from '../ranking/adaptateur.js';
import { creerPlateau } from './plateau.js';
import { creerDe } from './de.js';
import { choisirNombreDeTours } from './choixTours.js';
import { monterResultats } from '../resultats/resultats.js';

const params = new URLSearchParams(location.search);
const scene = document.querySelector('#agora-scene');
const FACES = ['preference', 'situation', 'decouverte', 'passerelle', 'surprise', 'pause'];

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
// Règles : 1er tour = préférence (prise en main), pas deux fois de suite le même type,
// au plus une pause par tranche de 5 tours, jamais de pause au dernier tour.
function tirerLancers(nbTours) {
  const lancers = [];
  let pauses = 0;
  let i = 0;
  while (i < nbTours) {
    let type = i === 0 ? 'preference' : FACES[Math.floor(Math.random() * FACES.length)];
    let essais = 0;
    while (i > 0 && essais < 50 && (type === lancers[i - 1] ||
           (type === 'pause' && (pauses >= Math.floor(nbTours / 5) || i === nbTours - 1)))) {
      type = FACES[Math.floor(Math.random() * FACES.length)];
      essais++;
    }
    if (type === 'pause') pauses++;
    lancers.push(type);
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

function demarrer() {
  solEnArrierePlan();
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

  function masquerBandeauE1() {
    const e1Jeu = scene.querySelector('#e1-game');
    if (e1Jeu) e1Jeu.setAttribute('visible', false);
  }

  async function lancerPartie(profil, nbTours) {
    const ranking = globalThis.RankingModule ? creerRankingC1(globalThis.RankingModule) : null;
    const game = createGame({
      dataPath: 'data/',
      ranking,
      acceptedStatuses: params.has('brouillon') ? ['relu', 'genere'] : ['relu'],
      diceFaces: 1,                 // le pion avance d'une case par tour ; le dé 3D montre le type
      rollMs: 1700,                 // durée de l'animation du dé
      durationMs: 6 * 60 * 60 * 1000, // pas de chrono : la partie finit au centre de la spirale
      board: { loop: false, start: 0, cases: ['pause'].concat(tirerLancers(nbTours)) }
    });
    window.agoraGame = game;
    game.bridgeToDom(document);

    const plateau = creerPlateau(scene.querySelector('#plateau-sol'), game);
    const de = creerDe(zoneJeu, game, CASE_TYPES, { x: 1.45, y: 1.0, z: -1.75 });

    const arrets = [game.on('game:ended', ({ results }) => {
      if (partie && partie.ui) {
        partie.ui.destroy();
        partie.ui = null;
      }
      de.detruire();
      resultatsAffiches = true;
      masquerBandeauE1();
      const issu = results && results.ranking && Array.isArray(results.ranking.results) ? results.ranking.results : [];
      scene.emit('partie-terminee', { profil, classement: issu.length > 0 ? issu : classementDeRepli(profil) });
    })];

    partie = { game, ui: null, plateau, de, arrets };
    const r = await game.initGame(profil.id);
    if (!r.ok) {
      console.error('[agora] partie impossible :', r.code, r.message);
      return;
    }
    partie.ui = attachVrUI(game, ancrageUI, {
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
