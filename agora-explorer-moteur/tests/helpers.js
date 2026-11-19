// Outils partagés par les tests : données fictives, faux fetch, fausse horloge.

import { ATTRIBUTES } from '../engine/config.js';
import { createGame } from '../engine/game.js';

const attributes = (value) => Object.fromEntries(ATTRIBUTES.map((key) => [key, value]));

export const answer = (id, effets = {}) => ({ id, texte: `Réponse ${id}`, picto: 'test', effets });

export const card = (id, type, extra = {}) => ({
  id,
  type,
  texte: `Texte de la case ${id}`,
  metiers_cibles: [],
  reponses: [answer('a', { creativite: 1 }), answer('b', { creativite: -1 })],
  statut: 'relu',
  ...extra,
});

export function baseData() {
  return {
    profils: [
      {
        id: '4821',
        fictif: true,
        riasec: { R: 72, I: 40, A: 65, S: 55, E: 30, C: 20 },
        aptitudes: {},
        hexaco: { H: 50, E: 60, X: 40, A: 70, C: 55, O: 65 },
        champ_des_possibles: [{ onet: '11-1111.00', zone: 2 }],
        classement_entretien: ['11-1111.00'],
      },
      {
        id: '0042',
        fictif: true,
        riasec: { R: 10, I: 20, A: 30, S: 40, E: 50, C: 60 },
        aptitudes: {},
        hexaco: { H: 50, E: 50, X: 50, A: 50, C: 50, O: 50 },
        champ_des_possibles: [{ onet: '22-2222.00', zone: 3 }],
        classement_entretien: ['22-2222.00'],
      },
    ],
    metiers: [
      { onet: '11-1111.00', titre: 'Métier un', attributs: attributes(0.8) },
      { onet: '22-2222.00', titre: 'Métier deux', attributs: attributes(0.2) },
      { onet: '33-3333.00', titre: 'Métier trois', attributs: attributes(0.5) },
    ],
    cases: [
      card('pre-1', 'preference', { reponses: [answer('a', { exterieur: 1 }), answer('b', { exterieur: -1 })] }),
      card('pre-2', 'preference', { reponses: [answer('a', { technologie: 0.5 }), answer('b', {}), answer('c', { technologie: -1 })] }),
      card('sit-1', 'situation', { metiers_cibles: ['11-1111.00'] }),
      card('sit-2', 'situation', { metiers_cibles: ['22-2222.00'] }),
      card('dec-1', 'decouverte', { metiers_cibles: ['11-1111.00'], reponses: [] }),
      card('pas-1', 'passerelle', { de: '11-1111.00', vers: '33-3333.00' }),
      card('pau-1', 'pause', { reponses: [] }),
      card('sur-1', 'surprise'),
      card('brouillon-1', 'preference', { statut: 'brouillon' }),
    ],
  };
}

// Un plateau fait d'un seul type de case : on sait sur quoi le pion va tomber.
export const boardOf = (type, size = 16) => ({ cases: Array(size).fill(type) });

// Moteur de test : données injectées, aucune attente pour le dé et le pion.
export function makeGame(options = {}) {
  return createGame({ data: baseData(), rollMs: 0, stepMs: 0, ...options });
}

export async function readyGame(options = {}, profileId = '4821') {
  const game = makeGame(options);
  const result = await game.initGame(profileId);
  if (!result.ok) {
    throw new Error(`initGame a échoué : ${result.code}`);
  }
  game.startGame();
  return game;
}

// Ferme la carte affichée : première réponse si c'est une question, « continuer » sinon.
export function answerCurrent(game) {
  const question = game.getCurrentQuestion();
  return question.informative ? game.continueGame() : game.submitAnswer(question.reponses[0].id, question.id);
}

// Joue un tour complet : lance le dé, puis ferme la carte de la case d'arrivée.
export async function playTurn(game, diceValue) {
  const roll = await game.rollDice(diceValue);
  const question = game.getCurrentQuestion();
  if (!question) {
    return { roll, question: null };
  }
  return { roll, question, action: answerCurrent(game) };
}

export function fakeClock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}

// Remplace les attentes du moteur : rien n'avance tant qu'on n'appelle pas release().
export function manualWait() {
  let pending = [];
  return {
    wait: () => new Promise((resolve) => pending.push(resolve)),
    release: () => {
      const toResolve = pending;
      pending = [];
      toResolve.forEach((resolve) => resolve());
    },
  };
}

export const flush = () => new Promise((resolve) => setImmediate(resolve));

// Faux fetch : `files` associe une URL à son contenu texte. URL absente = 404.
export function fakeFetch(files) {
  return async (url) => {
    if (!(url in files)) {
      return { ok: false, status: 404, text: async () => 'Not Found' };
    }
    return { ok: true, status: 200, text: async () => files[url] };
  };
}

export function jsonFiles(data = baseData(), folder = 'data/') {
  return {
    [`${folder}profils.json`]: JSON.stringify(data.profils),
    [`${folder}cases.json`]: JSON.stringify(data.cases),
    [`${folder}metiers.json`]: JSON.stringify(data.metiers),
  };
}

// Faux module de ranking : il note les appels reçus, il ne calcule aucun score.
export function spyRanking(extra = {}) {
  const calls = { init: [], applyAnswer: [], getResults: 0, getExplanation: 0 };
  return {
    calls,
    init: (metiers, profil) => calls.init.push({ metiers, profil }),
    applyAnswer: (effets, contexte) => calls.applyAnswer.push({ effets, contexte }),
    getResults: () => {
      calls.getResults += 1;
      return [{ onet: '11-1111.00', score: 42 }];
    },
    getExplanation: () => {
      calls.getExplanation += 1;
      return 'explication de test';
    },
    ...extra,
  };
}

export function collectEvents(game) {
  const events = [];
  game.on('*', (name, payload) => events.push({ name, payload }));
  return events;
}
