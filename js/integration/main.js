// Assemblage du produit : scène et accueil (E1) -> partie (E2 + ranking C1) -> résultats (E3).
//
//   E1 émet « agora-start » { profile } quand le code à 4 chiffres est validé ;
//   E2 joue la partie (plateau, dé, cartes, chrono) et émet « game:ended » ;
//   C1 classe les métiers pendant la partie (js/ranking/adaptateur.js) ;
//   E3 écoute « partie-terminee » { profil, classement } et affiche tableau + fiches.
//
// Paramètres d'URL utiles pour tester :
//   ?duree=60      partie d'une minute au lieu de 20
//   ?brouillon     joue aussi les cases au statut « genere » (pas encore relues)
//   ?gaze=1        curseur au regard sur ordinateur (géré par E1)

import { createGame } from '../../agora-explorer-moteur/engine/game.js';
import { attachVrUI } from '../../agora-explorer-moteur/ui/vrUI.js';
import { creerRankingC1 } from '../ranking/adaptateur.js';
import { creerPlateau } from './plateau.js';
import { monterResultats } from '../resultats/resultats.js';

const params = new URLSearchParams(location.search);
const scene = document.querySelector('#agora-scene');

// Sans ranking.js, on garde un classement neutre : l'ordre de l'entretien, tout « à explorer ».
function classementDeRepli(profil) {
  const ordre = [];
  const favoris = profil.classement_entretien || [];
  const champ = profil.champ_des_possibles || [];
  let i = 0;
  while (i < favoris.length) {
    if (ordre.indexOf(favoris[i]) === -1) ordre.push(favoris[i]);
    i++;
  }
  i = 0;
  while (i < champ.length) {
    if (ordre.indexOf(champ[i].onet) === -1) ordre.push(champ[i].onet);
    i++;
  }
  const sortie = [];
  i = 0;
  while (i < ordre.length) {
    sortie.push({ onet: ordre[i], rang: i + 1, categorie: 'a_explorer', raisons: [] });
    i++;
  }
  return sortie;
}

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

function demarrer() {
  solEnArrierePlan();
  const secondes = Number(params.get('duree'));
  const ranking = globalThis.RankingModule ? creerRankingC1(globalThis.RankingModule) : null;
  if (!ranking) console.warn('[agora] ranking.js absent : classement neutre en fin de partie.');

  const game = createGame({
    dataPath: 'data/',
    ranking,
    acceptedStatuses: params.has('brouillon') ? ['relu', 'genere'] : ['relu'],
    ...(secondes > 0 ? { durationMs: secondes * 1000 } : {})
  });
  window.agoraGame = game;
  game.bridgeToDom(document);

  creerPlateau(scene.querySelector('#plateau-sol'), game);
  monterResultats(scene, {
    parent: scene.querySelector('#results-root'),
    position: '0 0.05 2.2', // #results-root est à (0 1,25 -2,2) : on se recentre sur le joueur
    metiersUrl: 'data/metiers.json'
  });

  let ui = null;
  let profil = null;
  let resultatsAffiches = false;

  function masquerBandeauE1() {
    const e1Jeu = scene.querySelector('#e1-game');
    if (e1Jeu) e1Jeu.setAttribute('visible', false);
  }

  scene.addEventListener('agora-start', async (e) => {
    profil = e.detail.profile;
    if (ui) ui.destroy();
    const r = await game.initGame(profil.id);
    if (!r.ok) {
      console.error('[agora] partie impossible :', r.code, r.message);
      return;
    }
    ui = attachVrUI(game, scene.querySelector('#board-root'));
    game.startGame();
  });

  game.on('game:ended', ({ results }) => {
    if (ui) {
      ui.destroy();
      ui = null;
    }
    resultatsAffiches = true;
    masquerBandeauE1();
    const issu = results && results.ranking && Array.isArray(results.ranking.results) ? results.ranking.results : [];
    const classement = issu.length > 0 ? issu : classementDeRepli(profil || {});
    scene.emit('partie-terminee', { profil, classement });
  });

  // Consignes revues pendant la partie : le chrono s'arrête, puis reprend
  // seulement si c'est l'intro qui l'avait arrêté (une pause du joueur est respectée).
  let pauseParIntro = false;
  scene.addEventListener('agora-intro', (e) => {
    if (e.detail.open) {
      pauseParIntro = game.pauseGame().ok === true;
    } else if (e.detail.screen === 'game') {
      if (resultatsAffiches) masquerBandeauE1();
      else if (pauseParIntro) game.resumeGame();
      pauseParIntro = false;
    }
  });
}

if (scene.hasLoaded) demarrer();
else scene.addEventListener('loaded', demarrer, { once: true });
