// Tests du moteur. Lancer avec : npm test   (ou : node --test tests/)
// Les 15 premiers blocs reprennent les 15 scénarios du cahier des charges.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createBoard } from '../engine/board.js';
import { ATTRIBUTES, CASE_TYPES, MAX_TEXT_LENGTH, STATES } from '../engine/config.js';
import { validateGameData } from '../engine/dataLoader.js';
import { rollDie } from '../engine/dice.js';
import { TRANSITIONS, createGame } from '../engine/game.js';
import { createTimer } from '../engine/timer.js';
import {
  answer,
  answerCurrent,
  baseData,
  boardOf,
  card,
  collectEvents,
  fakeClock,
  fakeFetch,
  flush,
  jsonFiles,
  makeGame,
  manualWait,
  playTurn,
  readyGame,
  spyRanking,
} from './helpers.js';

const TWENTY_MINUTES = 20 * 60 * 1000;

// ---------------------------------------------------------------------------
// Les 15 scénarios demandés
// ---------------------------------------------------------------------------

test('1. initialisation normale', async () => {
  const game = makeGame();
  assert.equal(game.state, STATES.IDLE);

  const result = await game.initGame('4821');
  const state = game.getGameState();

  assert.equal(result.ok, true);
  assert.equal(state.state, STATES.READY);
  assert.equal(state.position, 0);
  assert.equal(state.turn, 0);
  assert.equal(state.board.size, 16);
  assert.deepEqual(new Set(state.board.cases.map((boardCase) => boardCase.type)), new Set(Object.keys(CASE_TYPES)));
  assert.equal(state.timer.remainingMs, TWENTY_MINUTES);
  assert.equal(state.timer.running, false);
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.warnings, []);
  assert.deepEqual(Object.keys(state.effectsTotal), [...ATTRIBUTES]);
});

test('2. profil valide (texte, espaces, nombre, zéros en tête)', async () => {
  for (const [input, expected] of [['4821', '4821'], [' 4821 ', '4821'], [4821, '4821'], ['0042', '0042'], [42, '0042']]) {
    const game = makeGame();
    const result = await game.initGame(input);
    assert.equal(result.ok, true, `identifiant ${JSON.stringify(input)}`);
    assert.equal(result.profile.id, expected);
    assert.equal(result.profile.champDesPossibles[0].titre !== null, true);
  }
});

test('3. profil inexistant : erreur claire, puis nouvelle saisie possible', async () => {
  const game = makeGame();

  const missing = await game.initGame('9999');
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'PROFILE_NOT_FOUND');
  assert.match(missing.message, /9999/);
  assert.equal(game.state, STATES.ERROR);
  assert.equal(game.getGameState().lastError.code, 'PROFILE_NOT_FOUND');
  assert.equal(game.startGame().code, 'INVALID_STATE');

  for (const bad of ['12', 'abcd', '', null, undefined, '48211', '48 21']) {
    const result = await game.initGame(bad);
    assert.equal(result.code, 'PROFILE_ID_INVALID', `identifiant ${JSON.stringify(bad)}`);
    assert.equal(game.state, STATES.ERROR);
  }

  const retry = await game.initGame('4821');
  assert.equal(retry.ok, true);
  assert.equal(game.state, STATES.READY);
  assert.equal(game.getGameState().lastError, null);
});

test('4. lancer de dé', async () => {
  const faces = new Set();
  for (let i = 0; i < 6000; i += 1) {
    const value = rollDie();
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 6);
    faces.add(value);
  }
  assert.equal(faces.size, 6);
  assert.equal(rollDie(6, () => 0), 1);
  assert.equal(rollDie(6, () => 0.9999), 6);
  assert.equal(rollDie(6, () => 1), 6);

  const game = await readyGame();
  for (const invalid of [0, 7, 2.5, -1, Number.NaN]) {
    const rejected = await game.rollDice(invalid);
    assert.equal(rejected.code, 'INVALID_DICE');
    assert.equal(game.state, STATES.PLAYING);
    assert.equal(game.getGameState().turn, 0);
  }

  const events = collectEvents(game);
  const roll = await game.rollDice(4);
  assert.equal(roll.ok, true);
  assert.equal(roll.value, 4);
  assert.equal(game.getGameState().lastRoll, 4);
  assert.deepEqual(events.filter((event) => event.name.startsWith('dice:')).map((event) => [event.name, event.payload.value]), [
    ['dice:rolling', 4],
    ['dice:rolled', 4],
  ]);

  // Sans valeur imposée (ou avec un objet, ex. un événement de clic) : tirage aléatoire.
  answerCurrent(game);
  const random = await game.rollDice({ type: 'click' });
  assert.ok(random.value >= 1 && random.value <= 6);
});

test('5. déplacement du pion', async () => {
  const game = await readyGame();
  const events = collectEvents(game);

  await game.rollDice(4);
  assert.equal(game.getGameState().position, 4);
  assert.deepEqual(events.filter((event) => event.name === 'pawn:step').map((event) => event.payload.position), [1, 2, 3, 4]);
  const moved = events.find((event) => event.name === 'pawn:moved').payload;
  assert.deepEqual([moved.from, moved.to], [0, 4]);
  assert.equal(game.getCurrentCase().index, 4);

  // Plateau en boucle : on repasse par le départ et on compte un tour.
  answerCurrent(game);
  await playTurn(game, 6); // 10
  await playTurn(game, 3); // 13
  await game.rollDice(5); // 18 -> case 2
  assert.equal(game.getGameState().position, 2);
  assert.equal(game.getGameState().lap, 1);

  // movePlayer : déplacement direct, sans dé.
  const direct = await readyGame();
  assert.equal((await direct.movePlayer(3)).position, 3);
  direct.skipQuestion();
  for (const invalid of [0, 13, 1.5, '2']) {
    assert.equal((await direct.movePlayer(invalid)).code, 'INVALID_STEPS');
  }
});

test('5 bis. plateau en ligne : la dernière case termine la partie', async () => {
  const game = await readyGame({ board: { loop: false, cases: ['preference', 'situation', 'preference', 'situation', 'preference'] } });
  await playTurn(game, 2);
  assert.equal(game.state, STATES.PLAYING);
  const { roll } = await playTurn(game, 6); // dépasse la fin : s'arrête sur la dernière case
  assert.equal(roll.position, 4);
  assert.equal(game.state, STATES.FINISHED);
  assert.equal(game.getResults().reason, 'board_end');
});

test('6. arrivée sur une case question', async () => {
  const game = await readyGame({ board: boardOf('situation') });
  const events = collectEvents(game);

  await game.rollDice(3);
  const question = game.getCurrentQuestion();

  assert.equal(game.state, STATES.QUESTION);
  assert.equal(question.type, 'situation');
  assert.equal(question.type, game.getCurrentCase().type);
  assert.equal(question.color, CASE_TYPES.situation.color);
  assert.ok(question.reponses.length >= 2 && question.reponses.length <= 4);
  assert.equal(question.informative, false);
  for (const option of question.reponses) {
    assert.deepEqual(Object.keys(option).sort(), ['id', 'picto', 'texte']); // les effets ne sortent pas vers l'interface
  }
  assert.equal(events.filter((event) => event.name === 'question:shown').length, 1);
  assert.equal(events.filter((event) => event.name === 'case:entered').length, 1);
});

test('7. sélection d\'une réponse', async () => {
  const game = await readyGame({ board: boardOf('preference') });
  await game.rollDice(1);
  const question = game.getCurrentQuestion();

  const unknown = game.submitAnswer('zzz');
  assert.equal(unknown.code, 'UNKNOWN_ANSWER');
  assert.equal(game.state, STATES.QUESTION);

  const stale = game.submitAnswer(question.reponses[0].id, 'une-autre-question');
  assert.equal(stale.code, 'STALE_QUESTION');
  assert.equal(game.state, STATES.QUESTION);

  const accepted = game.submitAnswer(question.reponses[0].id, question.id);
  assert.equal(accepted.ok, true);
  assert.equal(game.state, STATES.PLAYING);
  assert.equal(game.getCurrentQuestion(), null);
});

test('8. enregistrement des effets', async () => {
  const data = baseData();
  data.cases = [
    card('pre-1', 'preference', { reponses: [answer('a', { exterieur: 1, creativite: 0.5 }), answer('b', { exterieur: -1 })] }),
    card('pre-2', 'preference', { reponses: [answer('a', { exterieur: 0.5 }), answer('b', {})] }),
  ];
  const game = await readyGame({ data, board: boardOf('preference') });

  await game.rollDice(2);
  const first = game.getCurrentQuestion();
  game.submitAnswer('a');
  await game.rollDice(1);
  game.submitAnswer('a');

  const { history, effectsTotal } = game.getGameState();
  assert.equal(history.length, 2);
  assert.equal(history[0].questionId, first.id);
  assert.equal(history[0].answerId, 'a');
  assert.equal(history[0].dice, 2);
  assert.equal(history[0].caseType, 'preference');
  assert.equal(history[0].skipped, false);
  assert.equal(effectsTotal.exterieur, 1.5);
  assert.equal(effectsTotal.creativite, 0.5);
  assert.equal(effectsTotal.technologie, 0);
  assert.deepEqual(game.getResults().effectsTotal, effectsTotal);

  // L'état renvoyé est une copie : le modifier ne touche pas au moteur.
  history.push('intrus');
  effectsTotal.exterieur = 99;
  assert.equal(game.getHistory().length, 2);
  assert.equal(game.getGameState().effectsTotal.exterieur, 1.5);
});

test('9. appel au ranking de C1', async () => {
  const ranking = spyRanking();
  const game = await readyGame({ ranking, board: boardOf('preference') });

  assert.equal(ranking.calls.init.length, 1);
  assert.equal(ranking.calls.init[0].metiers.length, 3);
  assert.equal(ranking.calls.init[0].profil.id, '4821');
  assert.deepEqual(ranking.calls.init[0].profil.classement_entretien, ['11-1111.00']);

  await game.rollDice(1);
  const question = game.getCurrentQuestion();
  const submitted = game.submitAnswer('a');

  assert.equal(ranking.calls.applyAnswer.length, 1);
  assert.deepEqual(ranking.calls.applyAnswer[0].effets, submitted.effets);
  assert.equal(ranking.calls.applyAnswer[0].contexte.questionId, question.id);
  assert.equal(ranking.calls.applyAnswer[0].contexte.answerId, 'a');

  const { results } = game.endGame();
  assert.deepEqual(results.ranking, {
    available: true,
    results: [{ onet: '11-1111.00', score: 42 }],
    explanation: 'explication de test',
  });

  // Le module reçoit des copies : s'il les modifie, les données du moteur ne bougent pas.
  ranking.calls.init[0].metiers[0].titre = 'modifié';
  assert.equal(game.getJob('11-1111.00').titre, 'Métier un');
});

test('9 bis. ranking absent, incomplet ou en panne : la partie continue', async () => {
  const without = await readyGame({ board: boardOf('preference') });
  await playTurn(without, 1);
  const results = without.endGame().results;
  assert.deepEqual(results.ranking, { available: false, results: null, explanation: null });
  assert.equal(results.history.length, 1);

  const broken = spyRanking({
    applyAnswer: () => {
      throw new Error('boum');
    },
  });
  const game = await readyGame({ ranking: broken, board: boardOf('preference') });
  const { action } = await playTurn(game, 1);
  await playTurn(game, 1);
  assert.equal(action.ok, true);
  assert.equal(game.state, STATES.PLAYING);
  assert.equal(game.getGameState().warnings.filter((warning) => warning.includes('ranking.applyAnswer')).length, 1);
  assert.equal(game.getGameState().ranking.failures, 2);

  // Un objet sans aucune fonction du contrat (ex. un élément DOM avec id="ranking") n'est pas un ranking.
  const notARanking = await readyGame({ ranking: { id: 'ranking', tagName: 'DIV' } });
  assert.equal(notARanking.getGameState().ranking.available, false);
});

test('9 ter. ranking global (window.ranking), branchement tardif, choix de la question', async () => {
  const globalSpy = spyRanking();
  globalThis.ranking = globalSpy;
  try {
    const game = await readyGame({ board: boardOf('preference') });
    await playTurn(game, 1);
    assert.equal(globalSpy.calls.init.length, 1);
    assert.equal(globalSpy.calls.applyAnswer.length, 1);
  } finally {
    delete globalThis.ranking;
  }

  // setRanking() en cours de partie : l'historique est rejoué dans le nouveau module.
  const late = await readyGame({ board: boardOf('preference') });
  await playTurn(late, 1);
  await playTurn(late, 1);
  const lateSpy = spyRanking();
  late.setRanking(lateSpy);
  assert.equal(lateSpy.calls.init.length, 1);
  assert.equal(lateSpy.calls.applyAnswer.length, 2);
  await playTurn(late, 1);
  assert.equal(lateSpy.calls.applyAnswer.length, 3);

  // selectBestQuestion : le ranking choisit parmi les candidates proposées par le moteur.
  const seenCandidates = [];
  const chooser = spyRanking({
    selectBestQuestion: (candidates) => {
      seenCandidates.push(candidates.map((candidate) => candidate.id));
      return candidates.find((candidate) => candidate.id === 'pre-2') ?? candidates[0];
    },
  });
  const chosen = await readyGame({ ranking: chooser, board: boardOf('preference') });
  await chosen.rollDice(1);
  assert.equal(chosen.getCurrentQuestion().id, 'pre-2');
  assert.deepEqual(seenCandidates[0].sort(), ['pre-1', 'pre-2']);
});

test('10. case informative (reponses: [])', async () => {
  const ranking = spyRanking();
  const game = await readyGame({ ranking, board: boardOf('decouverte') });

  await game.rollDice(2);
  const question = game.getCurrentQuestion();
  assert.equal(game.state, STATES.QUESTION);
  assert.equal(question.informative, true);
  assert.deepEqual(question.reponses, []);
  assert.deepEqual(question.metiers, [{ onet: '11-1111.00', titre: 'Métier un' }]);

  assert.equal(game.submitAnswer('a').code, 'NO_ANSWER_EXPECTED');
  assert.equal(game.state, STATES.QUESTION);

  assert.equal(game.continueGame().ok, true);
  assert.equal(game.state, STATES.PLAYING);
  const [entry] = game.getHistory();
  assert.equal(entry.answerId, null);
  assert.deepEqual(entry.effets, {});
  assert.equal(entry.skipped, false);
  assert.equal(ranking.calls.applyAnswer.length, 0);

  // continueGame() ne permet pas d'esquiver une vraie question.
  const withQuestion = await readyGame({ board: boardOf('preference') });
  await withQuestion.rollDice(1);
  assert.equal(withQuestion.continueGame().code, 'ANSWER_REQUIRED');
  assert.equal(withQuestion.skipQuestion().ok, true);
  assert.equal(withQuestion.getHistory()[0].skipped, true);

  const noSkip = await readyGame({ board: boardOf('preference'), allowSkip: false });
  await noSkip.rollDice(1);
  assert.equal(noSkip.skipQuestion().code, 'SKIP_DISABLED');
  assert.equal(noSkip.state, STATES.QUESTION);
});

test('11. case pause', async () => {
  const game = await readyGame({ board: boardOf('pause') });
  await game.rollDice(1);
  const question = game.getCurrentQuestion();
  assert.equal(question.type, 'pause');
  assert.equal(question.id, 'pau-1');
  assert.equal(question.informative, true);
  assert.equal(game.getGameState().timer.running, true); // la case pause n'arrête pas le chrono
  assert.equal(game.continueGame().ok, true);
  assert.equal(game.state, STATES.PLAYING);

  // Aucun contenu « pause » dans cases.json : carte de secours, la partie ne bloque pas.
  const data = baseData();
  data.cases = data.cases.filter((entry) => entry.type !== 'pause');
  const empty = await readyGame({ data, board: boardOf('pause') });
  assert.ok(empty.getGameState().warnings.some((warning) => warning.includes('pause')));
  await empty.rollDice(1);
  const fallback = empty.getCurrentQuestion();
  assert.equal(fallback.generic, true);
  assert.equal(fallback.informative, true);
  assert.equal(fallback.texte, CASE_TYPES.pause.fallbackText);
  assert.equal(empty.continueGame().ok, true);
  assert.equal(empty.state, STATES.PLAYING);
});

test('12. pause et reprise : le chrono s\'arrête vraiment', async () => {
  const clock = fakeClock();
  const game = await readyGame({ now: clock.now, board: boardOf('preference') });

  clock.advance(10_000);
  assert.equal(game.pauseGame().ok, true);
  assert.equal(game.state, STATES.PAUSED);
  assert.equal(game.getGameState().timer.running, false);
  assert.equal((await game.rollDice()).code, 'INVALID_STATE');
  assert.equal(game.pauseGame().code, 'INVALID_STATE');

  clock.advance(5 * 60_000); // cinq minutes de pause ne comptent pas
  assert.equal(game.resumeGame().ok, true);
  assert.equal(game.state, STATES.PLAYING);
  assert.equal(game.getGameState().timer.remainingMs, TWENTY_MINUTES - 10_000);
  assert.equal(game.resumeGame().code, 'INVALID_STATE');

  // Pause pendant une question : on retrouve la même question à la reprise.
  await game.rollDice(1);
  const question = game.getCurrentQuestion();
  game.pauseGame();
  assert.equal(game.getGameState().resumeTo, STATES.QUESTION);
  assert.equal(game.submitAnswer('a').code, 'INVALID_STATE');
  game.resumeGame();
  assert.equal(game.state, STATES.QUESTION);
  assert.equal(game.getCurrentQuestion().id, question.id);
  assert.equal(game.submitAnswer('a').ok, true);
});

test('12 bis. pause demandée pendant le lancer : appliquée à l\'arrivée du pion', async () => {
  const gate = manualWait();
  const game = await readyGame({ wait: gate.wait, board: boardOf('preference') });

  const rolling = game.rollDice(2);
  assert.equal(game.state, STATES.ROLLING);
  assert.deepEqual(game.pauseGame(), { ok: true, deferred: true });
  assert.equal(game.state, STATES.ROLLING);

  while (game.state === STATES.ROLLING || game.state === STATES.MOVING) {
    gate.release();
    await flush();
  }
  assert.equal((await rolling).ok, true);
  assert.equal(game.state, STATES.PAUSED);
  assert.equal(game.getGameState().resumeTo, STATES.QUESTION);
  game.resumeGame();
  assert.equal(game.state, STATES.QUESTION);

  // Une pause différée peut être annulée avant d'avoir été appliquée.
  game.submitAnswer('a');
  const second = game.rollDice(1);
  game.pauseGame();
  assert.equal(game.resumeGame().ok, true);
  while (game.state === STATES.ROLLING || game.state === STATES.MOVING) {
    gate.release();
    await flush();
  }
  await second;
  assert.equal(game.state, STATES.QUESTION);
});

test('13. fin de partie manuelle', async () => {
  const game = await readyGame({ board: boardOf('preference') });
  const events = collectEvents(game);
  await playTurn(game, 2);
  await game.rollDice(1); // on termine en pleine question

  const { ok, results } = game.endGame();
  assert.equal(ok, true);
  assert.equal(game.state, STATES.FINISHED);
  assert.equal(results.reason, 'manual');
  assert.equal(results.profileId, '4821');
  assert.equal(results.turns, 2);
  assert.equal(results.history.length, 1);

  const ended = events.filter((event) => event.name === 'game:ended');
  assert.equal(ended.length, 1);
  assert.deepEqual(ended[0].payload.results.history, results.history);

  // Partie terminée : plus aucune action de jeu n'est acceptée.
  assert.equal((await game.rollDice()).code, 'INVALID_STATE');
  assert.equal(game.submitAnswer('a').code, 'INVALID_STATE');
  assert.equal(game.pauseGame().code, 'INVALID_STATE');
  assert.equal(game.endGame().code, 'INVALID_STATE');
  assert.equal(game.startGame().code, 'INVALID_STATE');

  // ... mais on peut relancer une partie propre.
  assert.equal((await game.initGame('0042')).ok, true);
  assert.equal(game.state, STATES.READY);
  assert.deepEqual(game.getHistory(), []);
  assert.equal(game.getGameState().timer.remainingMs, TWENTY_MINUTES);
});

test('13 bis. fin au chrono : immédiate au repos, propre en pleine question', async () => {
  // Au repos (le joueur n'a pas lancé le dé) : la partie se termine tout de suite.
  const idleClock = fakeClock();
  const idle = await readyGame({ now: idleClock.now });
  idleClock.advance(TWENTY_MINUTES + 1);
  idle.timer.tick();
  assert.equal(idle.state, STATES.FINISHED);
  assert.equal(idle.getResults().reason, 'timer');

  // En pleine question : on laisse répondre, la réponse compte, puis la partie se termine.
  const clock = fakeClock();
  const game = await readyGame({ now: clock.now, board: boardOf('preference') });
  const events = collectEvents(game);
  await game.rollDice(1);
  clock.advance(TWENTY_MINUTES + 1);
  game.timer.tick();
  assert.equal(game.state, STATES.QUESTION);
  assert.equal(game.getGameState().timer.timeUp, true);
  assert.equal(events.filter((event) => event.name === 'timer:up').length, 1);

  assert.equal(game.submitAnswer('a').ok, true);
  assert.equal(game.state, STATES.FINISHED);
  assert.equal(game.getResults().reason, 'timer');
  assert.equal(game.getResults().history.length, 1);
  assert.deepEqual(events.map((event) => event.name).filter((name) => ['answer:recorded', 'game:ended'].includes(name)), [
    'answer:recorded',
    'game:ended',
  ]);
});

test('13 ter. nombre de tours maximum', async () => {
  const game = await readyGame({ maxTurns: 2, board: boardOf('preference') });
  await playTurn(game, 1);
  assert.equal(game.state, STATES.PLAYING);
  await playTurn(game, 1);
  assert.equal(game.state, STATES.FINISHED);
  assert.equal(game.getResults().reason, 'max_turns');
});

test('14. double sélection d\'une réponse et double lancer', async () => {
  const ranking = spyRanking();
  const game = await readyGame({ ranking, board: boardOf('preference') });

  // Deux lancers « en même temps » (double clic) : un seul part.
  const [first, second] = await Promise.all([game.rollDice(1), game.rollDice(1)]);
  assert.equal(first.ok, true);
  assert.equal(second.code, 'INVALID_STATE');
  assert.equal(game.getGameState().turn, 1);
  assert.equal(game.getGameState().position, 1);
  assert.equal((await game.rollDice()).code, 'INVALID_STATE'); // pas de dé pendant une question

  const question = game.getCurrentQuestion();
  const accepted = game.submitAnswer('a', question.id);
  const again = game.submitAnswer('a', question.id);
  const other = game.submitAnswer('b');

  assert.equal(accepted.ok, true);
  assert.equal(again.code, 'INVALID_STATE');
  assert.equal(other.code, 'INVALID_STATE');
  assert.equal(game.getHistory().length, 1);
  assert.equal(ranking.calls.applyAnswer.length, 1);
  const total = Object.values(game.getGameState().effectsTotal).reduce((sum, value) => sum + Math.abs(value), 0);
  const once = Object.values(accepted.effets).reduce((sum, value) => sum + Math.abs(value), 0);
  assert.equal(total, once);

  // Même si une interface renvoie une réponse depuis son propre écouteur, elle ne compte qu'une fois.
  const reentrant = [];
  game.on('answer:recorded', () => reentrant.push(game.submitAnswer('b')));
  await game.rollDice(1);
  assert.equal(game.submitAnswer('a').ok, true);
  assert.equal(reentrant.length, 1);
  assert.equal(reentrant[0].ok, false);
  assert.equal(game.getHistory().length, 2);
  assert.equal(ranking.calls.applyAnswer.length, 2);
});

test('15. JSON absent ou mal formé', async () => {
  const files = jsonFiles();

  const withoutCases = { ...files };
  delete withoutCases['data/cases.json'];
  const missing = createGame({ fetch: fakeFetch(withoutCases) });
  const missingResult = await missing.initGame('4821');
  assert.equal(missingResult.code, 'JSON_MISSING');
  assert.match(missingResult.message, /cases\.json/);
  assert.equal(missing.state, STATES.ERROR);

  // Plusieurs fichiers en cause : le message les cite tous.
  const nothing = createGame({ fetch: fakeFetch({}) });
  const nothingResult = await nothing.initGame('4821');
  assert.equal(nothingResult.code, 'JSON_MISSING');
  assert.match(nothingResult.message, /profils\.json/);
  assert.match(nothingResult.message, /cases\.json/);

  const malformed = createGame({ fetch: fakeFetch({ ...files, 'data/profils.json': '[{ "id": "4821", ' }) });
  const malformedResult = await malformed.initGame('4821');
  assert.equal(malformedResult.code, 'JSON_INVALID');
  assert.match(malformedResult.message, /profils\.json/);
  assert.equal(malformed.state, STATES.ERROR);

  const html = createGame({ fetch: fakeFetch({ ...files, 'data/cases.json': '<!doctype html><html></html>' }) });
  const htmlResult = await html.initGame('4821');
  assert.equal(htmlResult.code, 'JSON_INVALID');
  assert.match(htmlResult.message, /HTML/);

  const notAnArray = createGame({ fetch: fakeFetch({ ...files, 'data/cases.json': '{"cases": []}' }) });
  assert.equal((await notAnArray.initGame('4821')).code, 'DATA_INVALID');

  const offline = createGame({
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal((await offline.initGame('4821')).code, 'JSON_MISSING');

  // metiers.json absent : avertissement, mais la partie reste jouable.
  const withoutJobs = { ...files };
  delete withoutJobs['data/metiers.json'];
  const noJobs = createGame({ fetch: fakeFetch(withoutJobs), rollMs: 0, stepMs: 0 });
  assert.equal((await noJobs.initGame('4821')).ok, true);
  assert.ok(noJobs.getGameState().warnings.some((warning) => warning.includes('metiers.json')));
  noJobs.startGame();
  assert.equal((await playTurn(noJobs, 1)).roll.ok, true);

  // Après une erreur, on corrige le fichier et on réessaie : pas de cache périmé.
  const repaired = { ...withoutCases };
  const game = createGame({ fetch: (url) => fakeFetch(repaired)(url) });
  assert.equal((await game.initGame('4821')).code, 'JSON_MISSING');
  repaired['data/cases.json'] = files['data/cases.json'];
  assert.equal((await game.initGame('4821')).ok, true);
  assert.equal(game.state, STATES.READY);
});

// ---------------------------------------------------------------------------
// Compléments
// ---------------------------------------------------------------------------

test('chargement : dossier de données et noms de fichiers configurables', async () => {
  const urls = [];
  const fetchSpy = (url) => {
    urls.push(url);
    return fakeFetch(jsonFiles(baseData(), 'mes-donnees/'))(url);
  };
  const game = createGame({ fetch: fetchSpy, dataPath: 'mes-donnees' });
  assert.equal((await game.initGame('4821')).ok, true);
  assert.deepEqual(urls.sort(), ['mes-donnees/cases.json', 'mes-donnees/metiers.json', 'mes-donnees/profils.json']);

  // Les données sont gardées d'une partie à l'autre, sauf si on demande un rechargement.
  await game.initGame('0042');
  assert.equal(urls.length, 3);
  await game.initGame('0042', { reload: true });
  assert.equal(urls.length, 6);
});

test('deux initGame en même temps : le second est refusé', async () => {
  const game = createGame({ fetch: fakeFetch(jsonFiles()) });
  const [first, second] = await Promise.all([game.initGame('4821'), game.initGame('4821')]);
  assert.equal(first.ok, true);
  assert.equal(second.code, 'BUSY');
  assert.equal(game.state, STATES.READY);
});

test('pas de question répétée tant qu\'il reste du contenu neuf', async () => {
  const data = baseData();
  data.cases = ['q1', 'q2', 'q3', 'q4'].map((id) => card(id, 'preference'));
  const game = await readyGame({ data, board: boardOf('preference') });
  const events = collectEvents(game);

  const ids = [];
  for (let turn = 0; turn < 12; turn += 1) {
    const { question } = await playTurn(game, 1);
    ids.push(question.id);
  }
  assert.equal(new Set(ids.slice(0, 4)).size, 4);
  assert.equal(new Set(ids.slice(4, 8)).size, 4); // deuxième passage : encore les 4, sans doublon
  for (let i = 1; i < ids.length; i += 1) {
    assert.notEqual(ids[i], ids[i - 1], 'jamais deux fois de suite la même carte');
  }
  assert.equal(events.filter((event) => event.name === 'content:exhausted').length, 1);
  assert.deepEqual(game.getGameState().content, {
    total: 4,
    seen: 4,
    remaining: 0,
    perType: { ...Object.fromEntries(Object.keys(CASE_TYPES).map((type) => [type, { total: 0, seen: 0 }])), preference: { total: 4, seen: 4 } },
  });
});

test('fin de partie optionnelle quand tout le contenu a été vu', async () => {
  const data = baseData();
  data.cases = [card('q1', 'preference'), card('q2', 'preference')];
  const game = await readyGame({ data, board: boardOf('preference'), endWhenContentExhausted: true });
  await playTurn(game, 1);
  assert.equal(game.state, STATES.PLAYING);
  await playTurn(game, 1);
  assert.equal(game.state, STATES.FINISHED);
  assert.equal(game.getResults().reason, 'content_exhausted');
});

test('seules les cases au statut « relu » sont jouées', async () => {
  const data = baseData();
  data.cases = [card('ok', 'preference'), card('brouillon', 'preference', { statut: 'brouillon' }), card('sans-statut', 'preference', { statut: undefined })];
  const game = await readyGame({ data, board: boardOf('preference') });
  for (let turn = 0; turn < 5; turn += 1) {
    const { question } = await playTurn(game, 1);
    assert.equal(question.id, 'ok');
  }
  assert.equal(validateGameData(data).stats.hiddenByStatus, 2);

  // La liste des statuts acceptés est configurable (utile pour relire les brouillons).
  const all = await readyGame({ data, board: boardOf('preference'), acceptedStatuses: ['relu', 'brouillon'] });
  assert.equal(all.getGameState().content.total, 2);
});

test('les cartes qui visent un métier du profil passent d\'abord', async () => {
  const data = baseData();
  data.cases = [
    card('pour-le-profil', 'situation', { metiers_cibles: ['11-1111.00'] }),
    card('pour-tous', 'situation', { metiers_cibles: [] }),
    card('autre-metier', 'situation', { metiers_cibles: ['22-2222.00'] }),
  ];
  for (let run = 0; run < 20; run += 1) {
    const game = await readyGame({ data, board: boardOf('situation') });
    const ids = [];
    for (let turn = 0; turn < 3; turn += 1) {
      ids.push((await playTurn(game, 1)).question.id);
    }
    assert.deepEqual(ids.slice(0, 2).sort(), ['pour-le-profil', 'pour-tous']);
    assert.equal(ids[2], 'autre-metier'); // posée quand même plutôt que de répéter
  }

  // Les cases « surprise » ne tiennent pas compte du profil (matchProfile: false).
  data.cases = [card('s1', 'surprise', { metiers_cibles: ['22-2222.00'] }), card('s2', 'surprise', { metiers_cibles: ['11-1111.00'] })];
  const firsts = new Set();
  for (let run = 0; run < 60; run += 1) {
    const game = await readyGame({ data, board: boardOf('surprise') });
    firsts.add((await playTurn(game, 1)).question.id);
  }
  assert.deepEqual([...firsts].sort(), ['s1', 's2']);
});

test('cases passerelles : champs « de » et « vers »', async () => {
  const data = baseData();
  data.cases = [
    card('hors-profil', 'passerelle', { de: '22-2222.00', vers: '33-3333.00' }),
    card('depuis-le-profil', 'passerelle', { de: '11-1111.00', vers: '33-3333.00' }),
  ];
  const game = await readyGame({ data, board: boardOf('passerelle') });
  await game.rollDice(1);
  const question = game.getCurrentQuestion();
  assert.equal(question.id, 'depuis-le-profil');
  assert.deepEqual(question.passerelle, {
    de: { onet: '11-1111.00', titre: 'Métier un' },
    vers: { onet: '33-3333.00', titre: 'Métier trois' },
  });
  assert.equal(validateGameData(data).warnings.length, 0);

  data.cases.push(card('incomplete', 'passerelle', { de: '11-1111.00' }));
  assert.ok(validateGameData(data).warnings.some((warning) => warning.includes('incomplete') && warning.includes('vers')));
});

test('type de case inconnu sur le plateau : case neutre, la partie continue', async () => {
  const game = await readyGame({ board: { cases: ['preference', 'mystere', 'preference', 'situation'] } });
  assert.ok(game.getGameState().warnings.some((warning) => warning.includes('mystere')));
  assert.equal(game.getBoard().cases[1].type, null);

  const events = collectEvents(game);
  const roll = await game.rollDice(1);
  assert.equal(roll.ok, true);
  assert.equal(game.state, STATES.PLAYING);
  assert.equal(game.getCurrentQuestion(), null);
  assert.equal(events.filter((event) => event.name === 'question:shown').length, 0);
  assert.equal((await game.rollDice(1)).ok, true);
  assert.equal(game.state, STATES.QUESTION);

  const tooSmall = makeGame({ board: { cases: ['preference'] } });
  assert.equal((await tooSmall.initGame('4821')).code, 'BOARD_INVALID');
  assert.equal(tooSmall.state, STATES.ERROR);
});

test('validation des données : on écarte le douteux, on prévient, on ne plante pas', () => {
  const data = baseData();
  data.profils.push({ id: '4821', fictif: true }, { id: 'abc', fictif: true }, { id: '7777' }, 'pas un profil');
  data.metiers.push({ titre: 'sans code' }, { onet: '11-1111.00', titre: 'doublon' }, { onet: '44-4444.00', titre: 'sans attributs' });
  data.cases.push(
    card('type-inconnu', 'quiz'),
    card('pre-1', 'preference'),
    card('sans-texte', 'preference', { texte: '   ' }),
    { type: 'preference', texte: 'sans identifiant', statut: 'relu' },
    card('metier-inconnu', 'situation', { metiers_cibles: ['99-9999.00'] }),
    card('trop-long', 'preference', { texte: 'x'.repeat(MAX_TEXT_LENGTH + 1) }),
    card('effets', 'preference', {
      reponses: [
        answer('a', { creativite: 3, travail_équipe: 1, technologie: 'beaucoup', exterieur: -7 }),
        answer('b', { creativite: -0.5 }),
        answer('b', { creativite: 1 }),
        { texte: 'sans id' },
      ],
    }),
    card('cinq-reponses', 'preference', { reponses: ['a', 'b', 'c', 'd', 'e'].map((id) => answer(id)) }),
    card('une-reponse', 'preference', { reponses: [answer('a')] }),
    card('reponses-invalides', 'preference', { reponses: 'oui' }),
  );

  const { profils, cases, metiers, warnings } = validateGameData(data);
  const warned = (...words) => warnings.some((warning) => words.every((word) => warning.includes(word)));
  const byId = Object.fromEntries(cases.map((entry) => [entry.id, entry]));

  assert.deepEqual(profils.map((profile) => profile.id), ['4821', '0042', '7777']);
  assert.ok(warned('4821', 'double'));
  assert.ok(warned('abc', '4 chiffres'));
  assert.ok(warned('7777', 'fictif'));
  assert.deepEqual(profils[2].champ_des_possibles, []);

  assert.equal(metiers.length, 4);
  assert.ok(warned('44-4444.00', 'attributs'));

  assert.equal(byId['type-inconnu'], undefined);
  assert.ok(warned('type-inconnu', 'quiz'));
  assert.ok(warned('pre-1', 'double'));
  assert.equal(byId['sans-texte'], undefined);
  assert.ok(warned('identifiant manquant'));
  assert.ok(warned('metier-inconnu', '99-9999.00'));
  assert.ok(warned('trop-long', 'caractères'));

  assert.deepEqual(byId.effets.reponses.map((option) => option.id), ['a', 'b']);
  assert.deepEqual(byId.effets.reponses[0].effets, { creativite: 1, exterieur: -1 });
  assert.ok(warned('effets', 'travail_équipe'));
  assert.ok(warned('effets', 'technologie', 'non numérique'));
  assert.ok(warned('effets', 'ramené à 1'));

  assert.equal(byId['cinq-reponses'].reponses.length, 4);
  assert.ok(warned('une-reponse', 'une seule'));
  assert.deepEqual(byId['reponses-invalides'].reponses, []);

  assert.throws(() => validateGameData({ ...data, profils: [] }), { code: 'DATA_INVALID' });
  assert.throws(() => validateGameData({ ...data, cases: [card('x', 'preference', { statut: 'brouillon' })] }), { code: 'DATA_INVALID' });
  assert.throws(() => validateGameData({}), { code: 'DATA_INVALID' });
});

test('réinitialisation pendant un déplacement : tout s\'arrête proprement', async () => {
  const gate = manualWait();
  const game = await readyGame({ wait: gate.wait });
  const events = collectEvents(game);

  const rolling = game.rollDice(5);
  gate.release();
  await flush();
  assert.equal(game.state, STATES.MOVING);

  game.resetGame();
  assert.equal(game.state, STATES.IDLE);
  for (let i = 0; i < 10; i += 1) {
    gate.release();
    await flush();
  }
  assert.equal((await rolling).code, 'CANCELLED');
  assert.equal(game.state, STATES.IDLE);
  assert.equal(game.getCurrentQuestion(), null);
  assert.equal(events.filter((event) => event.name === 'question:shown').length, 0);
  assert.equal(game.getGameState().position, 0);

  // Même chose si on termine la partie pendant que le dé roule.
  const other = await readyGame({ wait: gate.wait });
  const pending = other.rollDice(3);
  assert.equal(other.endGame().ok, true);
  gate.release();
  await flush();
  assert.equal((await pending).code, 'CANCELLED');
  assert.equal(other.state, STATES.FINISHED);
});

test('un écouteur qui plante ne casse pas la partie', async (t) => {
  t.mock.method(console, 'error', () => {});
  const game = await readyGame({ board: boardOf('preference') });
  game.on('question:shown', () => {
    throw new Error("bug dans l'interface");
  });
  const unsubscribe = game.on('pawn:step', () => {
    throw new Error('autre bug');
  });

  assert.equal((await game.rollDice(2)).ok, true);
  assert.equal(game.state, STATES.QUESTION);
  assert.equal(game.submitAnswer('a').ok, true);
  assert.ok(console.error.mock.callCount() >= 2);

  unsubscribe();
  const before = console.error.mock.callCount();
  await game.rollDice(1);
  assert.equal(console.error.mock.callCount(), before + 1); // seul l'écouteur encore abonné plante
});

test('les actions s\'utilisent directement comme callbacks (clic, événement A-Frame)', async () => {
  const game = makeGame({ board: boardOf('preference') });
  const { initGame, startGame, rollDice, pauseGame, resumeGame, endGame } = game;
  const clickEvent = { type: 'click' };

  assert.equal((await initGame('4821')).ok, true);
  assert.equal(startGame(clickEvent).ok, true);
  const roll = await rollDice(clickEvent); // un événement n'est pas une valeur de dé : tirage normal
  assert.equal(roll.ok, true);
  assert.ok(roll.value >= 1 && roll.value <= 6);
  assert.equal(pauseGame(clickEvent).ok, true);
  assert.equal(resumeGame(clickEvent).ok, true);
  assert.equal(endGame(clickEvent).results.reason, 'manual');
});

test('pont vers les événements DOM (pour A-Frame)', async () => {
  const dispatched = [];
  const target = { dispatchEvent: (event) => dispatched.push(event) };
  const game = makeGame();
  const stop = game.bridgeToDom(target);

  await game.initGame('4821');
  game.startGame();
  const names = dispatched.map((event) => event.type);
  assert.ok(names.includes('agora:state:changed'));
  assert.ok(names.includes('agora:game:ready'));
  assert.ok(names.includes('agora:turn:ready'));
  assert.equal(dispatched.find((event) => event.type === 'agora:game:ready').detail.profile.id, '4821');

  stop();
  const count = dispatched.length;
  game.pauseGame();
  assert.equal(dispatched.length, count);
});

test('partie complète simulée : jamais bloquée, états toujours cohérents', async () => {
  for (let run = 0; run < 5; run += 1) {
    const clock = fakeClock();
    const ranking = spyRanking();
    const game = await readyGame({ now: clock.now, ranking });
    const states = [];
    game.on('state:changed', ({ from, to }) => states.push([from, to]));

    let turns = 0;
    while (game.state !== STATES.FINISHED && turns < 400) {
      assert.equal(game.state, STATES.PLAYING);
      if (turns % 7 === 3) {
        game.pauseGame();
        clock.advance(30_000);
        game.resumeGame();
      }
      const roll = await game.rollDice();
      assert.equal(roll.ok, true);
      clock.advance(25_000); // le joueur met 25 s à lire et répondre
      game.timer.tick();

      const question = game.getCurrentQuestion();
      assert.ok(question, 'une carte est affichée après chaque lancer');
      assert.equal(question.type, game.getCurrentCase().type);
      if (question.informative) {
        assert.equal(game.continueGame().ok, true);
      } else {
        const pick = question.reponses[turns % question.reponses.length];
        assert.equal(game.submitAnswer(pick.id, question.id).ok, true);
      }
      turns += 1;
    }

    const results = game.getResults();
    assert.equal(game.state, STATES.FINISHED);
    assert.equal(results.reason, 'timer');
    assert.equal(results.turns, 48); // 20 min / 25 s par tour
    assert.equal(results.history.length, turns);
    assert.ok(results.durationMs >= TWENTY_MINUTES && results.durationMs < TWENTY_MINUTES + 30_000);

    for (const [from, to] of states) {
      assert.ok(TRANSITIONS[from].includes(to), `transition ${from} -> ${to}`);
    }
    assert.deepEqual(game.getGameState().warnings, []);

    // Le cumul des effets est exactement la somme de l'historique, transmis une seule fois au ranking.
    const expected = Object.fromEntries(ATTRIBUTES.map((attribute) => [attribute, 0]));
    for (const entry of results.history) {
      for (const [attribute, value] of Object.entries(entry.effets)) {
        expected[attribute] = Math.round((expected[attribute] + value) * 1000) / 1000;
      }
    }
    assert.deepEqual(results.effectsTotal, expected);
    assert.equal(ranking.calls.applyAnswer.length, results.history.filter((entry) => entry.answerId !== null).length);
  }
});

// ---------------------------------------------------------------------------
// Briques seules
// ---------------------------------------------------------------------------

test('timer : compte le temps réel, pas les ticks', () => {
  const clock = fakeClock();
  const ticks = [];
  let ended = 0;
  const timer = createTimer({ durationMs: 60_000, now: clock.now, onTick: (remaining) => ticks.push(remaining), onEnd: () => (ended += 1) });

  assert.equal(timer.getRemainingMs(), 60_000);
  timer.start();
  timer.start(); // sans effet
  clock.advance(45_000); // un seul tick après 45 s (onglet en arrière-plan) : le temps reste juste
  timer.tick();
  assert.equal(timer.getRemainingMs(), 15_000);

  timer.pause();
  clock.advance(999_999);
  assert.equal(timer.getRemainingMs(), 15_000);
  assert.equal(timer.isRunning(), false);

  timer.resume();
  clock.advance(20_000);
  timer.tick();
  timer.tick();
  assert.equal(timer.getRemainingMs(), 0);
  assert.equal(ended, 1);
  assert.equal(timer.hasEnded(), true);
  assert.equal(ticks.at(-1), 0);
  timer.stop();
  assert.equal(timer.getElapsedMs(), 65_000);
});

test('plateau : configuration, boucle et ligne droite', () => {
  const warnings = [];
  const loop = createBoard({ cases: Array(16).fill('preference'), loop: true, start: 0 }, warnings);
  assert.deepEqual(warnings, []);
  assert.deepEqual(loop.computeMove(14, 3), { from: 14, to: 1, path: [15, 0, 1], laps: 1 });
  assert.equal(loop.end, null);
  assert.equal(loop.getCase(99), null);

  const line = createBoard({ cases: Array(15).fill('situation'), loop: false }, warnings);
  assert.deepEqual(line.computeMove(12, 6), { from: 12, to: 14, path: [13, 14], laps: 0 });
  assert.equal(line.end, 14);

  for (const size of [15, 16, 17, 18]) {
    const sized = [];
    createBoard({ cases: Array(size).fill('pause') }, sized);
    assert.deepEqual(sized, []);
  }
  const outOfRange = [];
  createBoard({ cases: Array(20).fill('pause') }, outOfRange);
  assert.equal(outOfRange.length, 1);
  assert.throws(() => createBoard({ cases: [] }), { code: 'BOARD_INVALID' });
  assert.throws(() => createBoard(undefined), { code: 'BOARD_INVALID' });

  // Chaque type a sa propre couleur.
  const colors = Object.values(CASE_TYPES).map((type) => type.color);
  assert.equal(new Set(colors).size, 6);
});

test('table des transitions : tous les états sont décrits', () => {
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), Object.values(STATES).sort());
});

// ---------------------------------------------------------------------------
// Données fictives livrées (data-test/)
// ---------------------------------------------------------------------------

test('données de test livrées : valides, complètes, sans avertissement', async () => {
  const folder = new URL('../data-test/', import.meta.url);
  const read = async (name) => JSON.parse(await readFile(new URL(name, folder), 'utf8'));
  const data = { profils: await read('profils.json'), cases: await read('cases.json'), metiers: await read('metiers.json') };

  const validated = validateGameData(data);
  assert.deepEqual(validated.warnings, []);
  assert.ok(validated.cases.length >= 10);
  assert.equal(validated.stats.hiddenByStatus, 2);
  assert.deepEqual(new Set(validated.cases.map((entry) => entry.type)), new Set(Object.keys(CASE_TYPES)));
  assert.ok(validated.cases.some((entry) => entry.reponses.length === 0));
  for (const entry of validated.cases) {
    assert.ok(entry.texte.length <= MAX_TEXT_LENGTH, `${entry.id} : ${entry.texte.length} caractères`);
    assert.ok(entry.reponses.length === 0 || (entry.reponses.length >= 2 && entry.reponses.length <= 4), entry.id);
  }
  for (const profile of validated.profils) {
    assert.equal(profile.fictif, true);
    const game = createGame({ data, rollMs: 0, stepMs: 0 });
    assert.equal((await game.initGame(profile.id)).ok, true);
    assert.deepEqual(game.getGameState().warnings, []);
    game.startGame();
    for (let turn = 0; turn < 40; turn += 1) {
      const { question } = await playTurn(game);
      assert.ok(question);
      assert.equal(question.generic, false);
    }
  }
});
