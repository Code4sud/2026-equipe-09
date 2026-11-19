// Moteur de jeu Agora Explorer (E2) : état et déroulement d'une partie.
//
// Le moteur ne touche ni au DOM ni à A-Frame. Les interfaces (PC, VR) appellent
// ses méthodes et écoutent ses événements :
//
//   const game = createGame({ dataPath: 'data/', ranking });
//   game.on('question:shown', ({ question }) => afficher(question));
//   await game.initGame('4821');   // charge les JSON, trouve le profil -> 'ready'
//   game.startGame();              // lance le chrono                   -> 'playing'
//   await game.rollDice();         // dé + déplacement + carte          -> 'question'
//   game.submitAnswer('a');        // enregistre la réponse             -> 'playing'
//
// Chaque action renvoie { ok: true, ... } ou { ok: false, code, message } :
// une action interdite dans l'état courant est refusée, jamais exécutée à moitié.

import { ATTRIBUTES, DEFAULT_CONFIG, STATES } from './config.js';
import { createBoard } from './board.js';
import {
  GameError,
  PROFILE_ID_PATTERN,
  loadGameData,
  normalizeProfileId,
  validateGameData,
} from './dataLoader.js';
import { isValidRoll, rollDie } from './dice.js';
import { createQuestionBank } from './questions.js';
import { createRankingAdapter } from './rankingAdapter.js';
import { createTimer } from './timer.js';

const S = STATES;
const MAX_STEPS = 12;

// Dans quel(s) état(s) chaque action est autorisée.
const ALLOWED_ACTIONS = Object.freeze({
  startGame: [S.READY],
  rollDice: [S.PLAYING],
  movePlayer: [S.PLAYING],
  submitAnswer: [S.QUESTION],
  continueGame: [S.QUESTION],
  skipQuestion: [S.QUESTION],
  pauseGame: [S.PLAYING, S.QUESTION, S.ROLLING, S.MOVING],
  resumeGame: [S.PAUSED],
  endGame: [S.PLAYING, S.QUESTION, S.ROLLING, S.MOVING, S.PAUSED],
});

// Enchaînements normaux entre états. resetGame() ramène à 'idle' depuis partout.
export const TRANSITIONS = Object.freeze({
  [S.IDLE]: [S.LOADING],
  [S.LOADING]: [S.READY, S.ERROR],
  [S.READY]: [S.PLAYING],
  [S.PLAYING]: [S.ROLLING, S.MOVING, S.PAUSED, S.FINISHED],
  [S.ROLLING]: [S.MOVING, S.FINISHED],
  [S.MOVING]: [S.QUESTION, S.PLAYING, S.FINISHED],
  [S.QUESTION]: [S.PLAYING, S.PAUSED, S.FINISHED],
  [S.PAUSED]: [S.PLAYING, S.QUESTION, S.FINISHED],
  [S.FINISHED]: [],
  [S.ERROR]: [],
});

// Actions liées à l'instance : `bouton.addEventListener('click', game.rollDice)` fonctionne.
const BOUND_ACTIONS = [
  'initGame', 'startGame', 'rollDice', 'movePlayer', 'submitAnswer', 'continueGame',
  'skipQuestion', 'pauseGame', 'resumeGame', 'endGame', 'resetGame', 'setRanking',
];

const CANCELLED = Object.freeze({
  ok: false,
  code: 'CANCELLED',
  message: 'Action annulée : la partie a été réinitialisée ou terminée entre-temps.',
});

const clone = (value) => (value === undefined || value === null ? null : JSON.parse(JSON.stringify(value)));
const round = (value) => Math.round(value * 1000) / 1000;
const emptyEffects = () => Object.fromEntries(ATTRIBUTES.map((attribute) => [attribute, 0]));

function buildConfig(options) {
  return {
    ...DEFAULT_CONFIG,
    ...options,
    files: { ...DEFAULT_CONFIG.files, ...options.files },
    board: { ...DEFAULT_CONFIG.board, ...options.board },
    random: options.random ?? Math.random,
    now: options.now ?? (() => Date.now()),
  };
}

export class Game {
  /**
   * @param {object} [options] Voir DEFAULT_CONFIG (config.js), plus :
   *   ranking  module de C1 (sinon `window.ranking` s'il existe)
   *   data     { profils, cases, metiers } déjà chargés : évite les fetch (tests)
   *   fetch, random, now, wait  remplaçables pour les tests
   */
  constructor(options = {}) {
    this.config = buildConfig(options);
    this.state = S.IDLE;
    this._listeners = new Map();
    this._rankingModule = options.ranking ?? null;
    this._data = null; // données validées, gardées d'une partie à l'autre
    this._session = 0; // change à chaque reset/fin : annule les actions asynchrones en cours
    for (const action of BOUND_ACTIONS) {
      this[action] = this[action].bind(this);
    }
    this._resetRuntime();
  }

  // -------------------------------------------------------------------------
  // Événements
  // -------------------------------------------------------------------------

  /** Écoute un événement ('*' = tous). Renvoie une fonction pour se désabonner. */
  on(eventName, handler) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  off(eventName, handler) {
    this._listeners.get(eventName)?.delete(handler);
  }

  /**
   * Relaie tous les événements du moteur en événements DOM (`agora:question:shown`...),
   * pratique pour les composants A-Frame : document.addEventListener('agora:...', e => e.detail).
   */
  bridgeToDom(target = globalThis.document, prefix = 'agora:') {
    return this.on('*', (eventName, detail) => {
      target.dispatchEvent(new CustomEvent(prefix + eventName, { detail }));
    });
  }

  _emit(eventName, payload = {}) {
    const call = (handler, ...args) => {
      try {
        handler(...args);
      } catch (error) {
        // Une interface qui plante dans son callback ne doit pas casser la partie.
        console.error(`[Agora] erreur dans un écouteur de « ${eventName} »`, error);
      }
    };
    for (const handler of [...(this._listeners.get(eventName) ?? [])]) {
      call(handler, payload);
    }
    for (const handler of [...(this._listeners.get('*') ?? [])]) {
      call(handler, eventName, payload);
    }
  }

  // -------------------------------------------------------------------------
  // Cycle de vie : initialisation, démarrage, pause, fin
  // -------------------------------------------------------------------------

  /** Charge les données et prépare une partie pour le profil donné (id à 4 chiffres). */
  async initGame(profileId, { reload = false } = {}) {
    if (this.state === S.LOADING) {
      return this._reject('initGame', 'BUSY', 'Un chargement est déjà en cours.');
    }
    this.resetGame();
    const session = this._session;
    this._setState(S.LOADING);

    try {
      const id = normalizeProfileId(profileId);
      if (!PROFILE_ID_PATTERN.test(id)) {
        throw new GameError('PROFILE_ID_INVALID', "L'identifiant doit comporter exactement 4 chiffres.");
      }
      if (!this._data || reload) {
        const data = await this._loadData();
        if (session !== this._session) {
          return CANCELLED;
        }
        this._data = data;
      }
      const profile = this._data.profils.find((candidate) => candidate.id === id);
      if (!profile) {
        throw new GameError(
          'PROFILE_NOT_FOUND',
          `Aucun profil ne correspond à l'identifiant ${id}. Vérifie le numéro et réessaie.`,
        );
      }
      this._setup(profile);
    } catch (error) {
      if (session !== this._session) {
        return CANCELLED;
      }
      return this._fail(error);
    }

    this._setState(S.READY);
    this._emit('game:ready', {
      profile: this.getProfileSummary(),
      board: this.getBoard(),
      warnings: [...this.warnings],
    });
    return { ok: true, profile: this.getProfileSummary() };
  }

  /** Démarre la partie et le chrono. */
  startGame() {
    const rejection = this._check('startGame');
    if (rejection) {
      return rejection;
    }
    this._setState(S.PLAYING);
    this.timer.start();
    this._emit('game:started', { durationMs: this.config.durationMs });
    this._emit('turn:ready', this._turnInfo());
    return { ok: true };
  }

  /**
   * Met la partie en pause (chrono arrêté). Pendant le lancer ou le déplacement,
   * la pause est différée : elle s'applique dès que le pion est arrivé.
   */
  pauseGame() {
    const rejection = this._check('pauseGame');
    if (rejection) {
      return rejection;
    }
    if (this.state === S.ROLLING || this.state === S.MOVING) {
      this.pausePending = true;
      return { ok: true, deferred: true };
    }
    this._pauseNow();
    return { ok: true, deferred: false };
  }

  resumeGame() {
    if (this.pausePending && (this.state === S.ROLLING || this.state === S.MOVING)) {
      this.pausePending = false; // pause demandée mais pas encore appliquée : on l'annule
      return { ok: true };
    }
    const rejection = this._check('resumeGame');
    if (rejection) {
      return rejection;
    }
    const target = this.previousState;
    this.previousState = null;
    this._setState(target);
    this.timer.resume();
    this._emit('game:resumed', { state: target });
    return { ok: true };
  }

  /** Termine la partie tout de suite (choix du joueur) et renvoie les résultats. */
  endGame(reason = 'manual') {
    const rejection = this._check('endGame');
    if (rejection) {
      return rejection;
    }
    this._finish(typeof reason === 'string' ? reason : 'manual');
    return { ok: true, results: this.getResults() };
  }

  /** Abandonne tout et revient à l'état 'idle' (les JSON déjà chargés sont gardés). */
  resetGame() {
    this._session += 1;
    this.timer?.stop();
    this._resetRuntime();
    if (this.state !== S.IDLE) {
      this._setState(S.IDLE);
      this._emit('game:reset', {});
    }
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Tour de jeu : dé, déplacement, carte, réponse
  // -------------------------------------------------------------------------

  /**
   * Lance le dé puis déplace le pion. La promesse se termine quand la carte de
   * la case d'arrivée est affichée. `forcedValue` (1 à 6) impose le résultat :
   * utile pour les tests, ou si la VR lance un dé physique et fournit sa valeur.
   */
  async rollDice(forcedValue) {
    const rejection = this._check('rollDice');
    if (rejection) {
      return rejection;
    }
    const faces = this.config.diceFaces;
    let value;
    if (typeof forcedValue === 'number') {
      if (!isValidRoll(forcedValue, faces)) {
        return this._reject('rollDice', 'INVALID_DICE', `Valeur de dé invalide : ${forcedValue} (entier de 1 à ${faces} attendu).`);
      }
      value = forcedValue;
    } else {
      value = rollDie(faces, this.config.random);
    }

    const session = this._session;
    this.turn += 1;
    this.lastRoll = value;
    this._setState(S.ROLLING);
    this._emit('dice:rolling', { value, durationMs: this.config.rollMs });
    await this._wait(this.config.rollMs);
    if (session !== this._session) {
      return CANCELLED;
    }
    this._emit('dice:rolled', { value });
    const arrived = await this._move(value, session);
    return arrived ? { ok: true, value, position: this.position } : CANCELLED;
  }

  /** Déplace le pion de `steps` cases sans lancer le dé (tests, cases spéciales). */
  async movePlayer(steps) {
    const rejection = this._check('movePlayer');
    if (rejection) {
      return rejection;
    }
    if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) {
      return this._reject('movePlayer', 'INVALID_STEPS', `Nombre de cases invalide : ${steps} (entier de 1 à ${MAX_STEPS} attendu).`);
    }
    this.turn += 1;
    this.lastRoll = null;
    const arrived = await this._move(steps, this._session);
    return arrived ? { ok: true, position: this.position } : CANCELLED;
  }

  /**
   * Enregistre la réponse du joueur. C'est LE point d'entrée unique, quel que
   * soit le périphérique : clic, regard validé, manette, clavier...
   * `questionId` est optionnel : s'il est fourni et ne correspond plus à la
   * carte affichée (clic tardif sur un ancien panneau), la réponse est refusée.
   */
  submitAnswer(answerId, questionId) {
    const rejection = this._check('submitAnswer');
    if (rejection) {
      return rejection;
    }
    const question = this.currentQuestion;
    if (!question) {
      return this._reject('submitAnswer', 'INVALID_STATE', 'Aucune question en cours.');
    }
    if (questionId !== undefined && questionId !== null && String(questionId) !== question.id) {
      return this._reject('submitAnswer', 'STALE_QUESTION', "Cette réponse concerne une question qui n'est plus affichée.");
    }
    if (question.informative) {
      return this._reject('submitAnswer', 'NO_ANSWER_EXPECTED', "Cette case n'attend pas de réponse : utilise continueGame().");
    }
    const answer = this.bank.findAnswer(question.id, answerId);
    if (!answer) {
      return this._reject('submitAnswer', 'UNKNOWN_ANSWER', `Réponse inconnue : ${answerId}.`);
    }

    // À partir d'ici la question est close : un second appel sera refusé.
    this.currentQuestion = null;
    const entry = this._record(question, { answer });
    for (const [attribute, value] of Object.entries(answer.effets)) {
      this.effectsTotal[attribute] = round(this.effectsTotal[attribute] + value);
    }
    this.ranking.applyAnswer({ ...answer.effets }, {
      questionId: question.id,
      answerId: answer.id,
      type: question.type,
      metiers_cibles: question.metiers.map((job) => job.onet),
    });
    this._emit('answer:recorded', { entry: clone(entry), effectsTotal: { ...this.effectsTotal } });
    this._emit('question:closed', { entry: clone(entry) });
    this._backToBoard();
    return { ok: true, effets: { ...answer.effets } };
  }

  /** Ferme une carte informative (sans réponses) et rend la main au joueur. */
  continueGame() {
    const rejection = this._check('continueGame');
    if (rejection) {
      return rejection;
    }
    if (!this.currentQuestion) {
      return this._reject('continueGame', 'INVALID_STATE', 'Aucune carte en cours.');
    }
    if (!this.currentQuestion.informative) {
      return this._reject('continueGame', 'ANSWER_REQUIRED', 'Cette question attend une réponse (ou skipQuestion() pour la passer).');
    }
    return this._closeWithoutAnswer({ skipped: false });
  }

  /** Passe la carte en cours sans répondre : aucun effet n'est enregistré. */
  skipQuestion() {
    const rejection = this._check('skipQuestion');
    if (rejection) {
      return rejection;
    }
    if (!this.currentQuestion) {
      return this._reject('skipQuestion', 'INVALID_STATE', 'Aucune carte en cours.');
    }
    if (!this.config.allowSkip && !this.currentQuestion.informative) {
      return this._reject('skipQuestion', 'SKIP_DISABLED', 'Passer une question est désactivé dans la configuration.');
    }
    return this._closeWithoutAnswer({ skipped: !this.currentQuestion.informative });
  }

  // -------------------------------------------------------------------------
  // Lecture de l'état
  // -------------------------------------------------------------------------

  /** Photo complète de la partie. C'est une copie : la modifier ne change rien au moteur. */
  getGameState() {
    return {
      state: this.state,
      resumeTo: this.previousState,
      pausePending: this.pausePending,
      profile: clone(this.profile),
      board: this.getBoard(),
      position: this.position,
      lap: this.lap,
      turn: this.turn,
      lastRoll: this.lastRoll,
      currentCase: this.getCurrentCase(),
      currentQuestion: clone(this.currentQuestion),
      history: clone(this.history),
      effectsTotal: { ...this.effectsTotal },
      timer: {
        durationMs: this.config.durationMs,
        remainingMs: this.timer ? this.timer.getRemainingMs() : this.config.durationMs,
        elapsedMs: this.timer ? this.timer.getElapsedMs() : 0,
        running: this.timer ? this.timer.isRunning() : false,
        timeUp: this.timeUp,
      },
      content: this.bank ? this.bank.stats() : null,
      ranking: this.ranking.status(),
      endReason: this.endReason,
      lastError: this.lastError ? { ...this.lastError } : null,
      warnings: [...this.warnings],
    };
  }

  /** Le plateau : { size, loop, start, end, cases: [{ index, number, type, label, color, ... }] }. */
  getBoard() {
    if (!this.board) {
      return null;
    }
    const { size, loop, start, end, cases } = this.board;
    return { size, loop, start, end, cases: cases.map((boardCase) => ({ ...boardCase })) };
  }

  /** La case du plateau où se trouve le pion. */
  getCurrentCase() {
    const boardCase = this.board?.getCase(this.position);
    return boardCase ? { ...boardCase } : null;
  }

  /** La carte affichée (question ou information), ou null. */
  getCurrentQuestion() {
    return clone(this.currentQuestion);
  }

  getHistory() {
    return clone(this.history);
  }

  /** Le profil prêt à être présenté au joueur, avec les titres des métiers. */
  getProfileSummary() {
    if (!this.profile) {
      return null;
    }
    const title = (onet) => this._data.metiersByOnet.get(onet)?.titre ?? null;
    return {
      id: this.profile.id,
      riasec: { ...this.profile.riasec },
      hexaco: { ...this.profile.hexaco },
      champDesPossibles: this.profile.champ_des_possibles.map((item) => {
        const onet = typeof item === 'string' ? item : item?.onet ?? null;
        return { onet, zone: item?.zone ?? null, titre: title(onet) };
      }),
      classementEntretien: this.profile.classement_entretien.map((onet) => ({ onet, titre: title(onet) })),
    };
  }

  /** La fiche d'un métier de metiers.json d'après son code O*NET, ou null. */
  getJob(onet) {
    return clone(this._data?.metiersByOnet.get(onet));
  }

  /**
   * Résultats de la partie, à transmettre à C1/E3. Disponibles aussi en cours de
   * partie (provisoires, `reason: null`). Le classement est celui de ranking.js,
   * relayé tel quel ; sans ranking.js, `ranking.available` vaut false.
   */
  getResults() {
    if (!this.profile) {
      return null;
    }
    const base = this.results ?? this._buildResults(null);
    return { ...base, history: clone(base.history), effectsTotal: { ...base.effectsTotal } };
  }

  /** Branche (ou remplace) le module de ranking de C1, même en cours de partie. */
  setRanking(rankingModule) {
    this._rankingModule = rankingModule ?? null;
    if (this.profile) {
      this._connectRanking({ replayHistory: true });
    }
    return { ok: true, available: this.ranking.available };
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  _resetRuntime() {
    this.profile = null;
    this.board = null;
    this.bank = null;
    this.timer = null;
    this.ranking = createRankingAdapter(null);
    this.position = 0;
    this.lap = 0;
    this.turn = 0;
    this.lastRoll = null;
    this.currentQuestion = null;
    this.history = [];
    this.effectsTotal = emptyEffects();
    this.previousState = null;
    this.pausePending = false;
    this.timeUp = false;
    this.endReason = null;
    this.results = null;
    this.lastError = null;
    this.warnings = [];
    this._exhaustedNotified = false;
  }

  _setState(next) {
    const previous = this.state;
    if (previous === next) {
      return;
    }
    if (next !== S.IDLE && !TRANSITIONS[previous].includes(next)) {
      this._warn(`Transition d'état inattendue : ${previous} -> ${next}.`);
    }
    this.state = next;
    this._emit('state:changed', { from: previous, to: next });
  }

  _check(action) {
    if (ALLOWED_ACTIONS[action].includes(this.state)) {
      return null;
    }
    return this._reject(action, 'INVALID_STATE', `Action « ${action} » impossible dans l'état « ${this.state} ».`);
  }

  _reject(action, code, message) {
    this._emit('action:rejected', { action, code, message, state: this.state });
    return { ok: false, code, message };
  }

  _warn(message) {
    this.warnings.push(message);
    this._emit('game:warning', { message });
  }

  _fail(error) {
    const expected = error instanceof GameError;
    if (!expected) {
      console.error('[Agora] erreur inattendue', error);
    }
    this.timer?.stop();
    this._resetRuntime(); // rien de partiellement initialisé ne doit rester
    this.lastError = {
      code: expected ? error.code : 'UNEXPECTED',
      message: expected ? error.message : `Erreur inattendue : ${error?.message ?? error}`,
    };
    this._setState(S.ERROR);
    this._emit('game:error', { ...this.lastError });
    return { ok: false, ...this.lastError };
  }

  _wait(ms) {
    if (typeof this.config.wait === 'function') {
      return this.config.wait(ms);
    }
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }

  async _loadData() {
    const { data, dataPath, files, acceptedStatuses } = this.config;
    if (data) {
      return validateGameData(data, { acceptedStatuses });
    }
    const fetchFn = this.config.fetch ?? (typeof fetch === 'function' ? (url, init) => fetch(url, init) : null);
    return loadGameData({ dataPath, files, fetchFn, acceptedStatuses });
  }

  _setup(profile) {
    const warnings = [...this._data.warnings];
    const board = createBoard(this.config.board, warnings);

    this.profile = profile;
    this.board = board;
    this.position = board.start;
    this.warnings = warnings;
    this.bank = createQuestionBank({
      cases: this._data.cases,
      profile,
      metiersByOnet: this._data.metiersByOnet,
      random: this.config.random,
      chooser: (candidates) => {
        if (!this.ranking.has('selectBestQuestion')) {
          return null; // pas de ranking : la banque de cartes tire au hasard
        }
        return this.ranking.selectBestQuestion(candidates, {
          profile: clone(this.profile),
          history: clone(this.history),
        });
      },
    });
    for (const type of new Set(board.cases.map((boardCase) => boardCase.type))) {
      if (type && this.bank.countForType(type) === 0) {
        warnings.push(`Aucune case jouable de type « ${type} » : une carte générique sera affichée.`);
      }
    }
    this.timer = createTimer({
      durationMs: this.config.durationMs,
      now: this.config.now,
      onTick: (remainingMs) => this._emit('timer:tick', { remainingMs, durationMs: this.config.durationMs }),
      onEnd: () => this._onTimeUp(),
    });
    this._connectRanking();
  }

  _connectRanking({ replayHistory = false } = {}) {
    const rankingModule = this._rankingModule ?? globalThis.ranking ?? null;
    this.ranking = createRankingAdapter(rankingModule, (message) => this._warn(message));
    // Copies : le module de C1 peut modifier ce qu'il reçoit sans toucher aux données du moteur.
    this.ranking.init(clone(this._data.metiers), clone(this.profile));
    if (replayHistory) {
      for (const entry of this.history) {
        if (entry.answerId !== null) {
          this.ranking.applyAnswer({ ...entry.effets }, {
            questionId: entry.questionId,
            answerId: entry.answerId,
            type: entry.caseType,
            metiers_cibles: [...entry.metiers_cibles],
          });
        }
      }
    }
  }

  _turnInfo() {
    return { turn: this.turn, position: this.position, case: this.getCurrentCase() };
  }

  // Renvoie true si le pion est arrivé, false si la partie a été interrompue en route.
  async _move(steps, session) {
    const move = this.board.computeMove(this.position, steps);
    this._setState(S.MOVING);
    this._emit('pawn:moving', { from: move.from, to: move.to, path: [...move.path], stepMs: this.config.stepMs });
    for (const index of move.path) {
      this.position = index;
      if (this.board.loop && index === this.board.start) {
        this.lap += 1;
      }
      this._emit('pawn:step', { position: index, case: this.getCurrentCase() });
      await this._wait(this.config.stepMs);
      if (session !== this._session) {
        return false;
      }
    }
    this._emit('pawn:moved', { from: move.from, to: move.to, lap: this.lap });
    this._enterCase();
    return true;
  }

  _enterCase() {
    const boardCase = this.getCurrentCase();
    this._emit('case:entered', { case: boardCase, turn: this.turn });
    let question = null;
    try {
      question = boardCase.type ? this.bank.pick(boardCase.type) : null;
    } catch (error) {
      console.error('[Agora] sélection de carte impossible', error);
      this._warn(`Case n°${boardCase.number} : erreur pendant le choix de la carte, on continue.`);
    }
    if (!question) {
      this._backToBoard(); // case neutre ou sans contenu : le joueur relance simplement
      return;
    }
    this.currentQuestion = question;
    this._setState(S.QUESTION);
    this._emit('question:shown', { question: clone(question), case: boardCase });
    if (!this._exhaustedNotified && this.bank.allSeen()) {
      this._exhaustedNotified = true;
      this._emit('content:exhausted', this.bank.stats());
    }
    this._applyPendingPause();
  }

  _record(question, { answer = null, skipped = false } = {}) {
    const entry = {
      turn: this.turn,
      elapsedMs: this.timer.getElapsedMs(),
      dice: this.lastRoll,
      caseIndex: this.position,
      caseType: question.type,
      questionId: question.id,
      questionTexte: question.texte,
      metiers_cibles: question.metiers.map((job) => job.onet),
      answerId: answer ? answer.id : null,
      answerTexte: answer ? answer.texte : null,
      effets: answer ? { ...answer.effets } : {},
      skipped,
    };
    this.history.push(entry);
    return entry;
  }

  _closeWithoutAnswer({ skipped }) {
    const question = this.currentQuestion;
    this.currentQuestion = null;
    const entry = this._record(question, { skipped });
    this._emit('question:closed', { entry: clone(entry) });
    this._backToBoard();
    return { ok: true, skipped };
  }

  // Fin d'un tour : soit la partie se termine proprement, soit le joueur relance.
  _backToBoard() {
    this.currentQuestion = null;
    const reason = this._endReason();
    if (reason) {
      this._finish(reason);
      return;
    }
    this._setState(S.PLAYING);
    this._emit('turn:ready', this._turnInfo());
    this._applyPendingPause();
  }

  _endReason() {
    if (this.timeUp) {
      return 'timer';
    }
    if (!this.board.loop && this.position === this.board.end) {
      return 'board_end';
    }
    if (this.config.maxTurns && this.turn >= this.config.maxTurns) {
      return 'max_turns';
    }
    if (this.config.endWhenContentExhausted && this.bank.allSeen()) {
      return 'content_exhausted';
    }
    return null;
  }

  _onTimeUp() {
    this.timeUp = true;
    this._emit('timer:up', { state: this.state });
    // En plein lancer, déplacement ou question : on laisse le tour se terminer,
    // c'est _backToBoard() qui clôturera la partie. Sinon on termine tout de suite.
    if (this.state === S.PLAYING) {
      this._finish('timer');
    }
  }

  _pauseNow() {
    this.pausePending = false;
    this.previousState = this.state;
    this.timer.pause();
    this._setState(S.PAUSED);
    this._emit('game:paused', { resumeTo: this.previousState });
  }

  _applyPendingPause() {
    if (this.pausePending && (this.state === S.PLAYING || this.state === S.QUESTION)) {
      this._pauseNow();
    }
  }

  _buildResults(reason) {
    return {
      profileId: this.profile.id,
      reason, // 'timer' | 'manual' | 'board_end' | 'max_turns' | 'content_exhausted' | null (en cours)
      durationMs: this.timer.getElapsedMs(),
      turns: this.turn,
      laps: this.lap,
      history: clone(this.history),
      effectsTotal: { ...this.effectsTotal },
      ranking: {
        available: this.ranking.available,
        results: this.ranking.getResults(),
        explanation: this.ranking.getExplanation(),
      },
    };
  }

  _finish(reason) {
    this._session += 1; // annule un lancer ou un déplacement encore en cours
    this.timer.stop();
    this.pausePending = false;
    this.previousState = null;
    this.currentQuestion = null;
    this.endReason = reason;
    this.results = this._buildResults(reason);
    this._setState(S.FINISHED);
    this._emit('game:ended', { results: this.getResults() });
  }
}

export function createGame(options = {}) {
  return new Game(options);
}

export { STATES, ATTRIBUTES, CASE_TYPES, DEFAULT_CONFIG } from './config.js';
export { GameError } from './dataLoader.js';
