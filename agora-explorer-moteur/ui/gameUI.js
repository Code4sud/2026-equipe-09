// Interface PC d'Agora Explorer : la partie complète se joue à la souris ou au clavier.
// Elle ne contient aucune règle du jeu : elle appelle le moteur et réagit à ses événements.
//
//   mountGameUI(game, document.querySelector('#app'), { testProfiles: ['4821'] });
//
// Raccourcis clavier : 1 à 4 = répondre, D ou Espace = lancer le dé, P = pause.

import { ATTRIBUTE_LABELS, STATES } from '../engine/config.js';
import { formatTime, frenchSpaces, jobLine } from './typography.js';

const S = STATES;
const IN_GAME = [S.PLAYING, S.ROLLING, S.MOVING, S.QUESTION, S.PAUSED];
const RING_RADIUS = 42; // en % du plateau
const PAWN_RADIUS = 29;

const RIASEC_LABELS = {
  R: 'Réaliste',
  I: 'Investigateur',
  A: 'Artistique',
  S: 'Social',
  E: 'Entreprenant',
  C: 'Conventionnel',
};

const END_REASONS = {
  timer: 'Le temps est écoulé.',
  manual: 'Tu as choisi de terminer la partie.',
  board_end: 'Tu as atteint la dernière case du plateau.',
  max_turns: 'Tous les tours ont été joués.',
  content_exhausted: 'Tu as vu toutes les cartes du jeu.',
};

// Quelles cellules (1 à 9, ligne par ligne) portent un point pour chaque face du dé.
const DICE_PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

const SKELETON = `
  <header class="topbar">
    <p class="brand">Agora Explorer</p>
    <p class="profile-tag" data-ref="profileTag" hidden></p>
    <p class="timer" data-ref="timer" hidden></p>
    <div class="topbar-actions">
      <button type="button" class="button" data-ref="pauseButton" hidden>Pause</button>
      <button type="button" class="button" data-ref="endButton" hidden>Terminer la partie</button>
      <button type="button" class="button button--quiet" data-ref="resetButton">Réinitialiser</button>
    </div>
  </header>
  <main class="stage">
    <section class="screen screen--login" data-ref="loginScreen" hidden>
      <h1>Entre ton identifiant</h1>
      <p class="lead">C'est le code à 4 chiffres de ton profil. Il lance une partie d'environ 20 minutes.</p>
      <form data-ref="loginForm" novalidate>
        <label for="agora-id">Identifiant à 4 chiffres</label>
        <div class="login-row">
          <input id="agora-id" data-ref="idInput" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="0000">
          <button type="submit" class="button button--primary" data-ref="loginButton">Valider</button>
        </div>
        <p class="form-error" data-ref="loginError" role="alert"></p>
      </form>
      <div class="test-profiles" data-ref="testProfiles" hidden></div>
    </section>
    <section class="screen screen--profile" data-ref="profileScreen" hidden></section>
    <section class="screen screen--play" data-ref="playScreen" hidden>
      <div class="board-zone">
        <div class="board">
          <div class="ring" data-ref="ring" role="img"></div>
          <div class="board-center">
            <button type="button" class="dice" data-ref="dice" aria-label="Lancer le dé"></button>
            <p class="dice-status" data-ref="diceStatus"></p>
          </div>
        </div>
        <ul class="legend" data-ref="legend"></ul>
      </div>
      <div class="card-zone" data-ref="cardZone" aria-live="polite"></div>
    </section>
    <section class="screen screen--results" data-ref="resultsScreen" hidden></section>
  </main>
  <details class="bench" data-ref="bench">
    <summary data-ref="benchSummary">Banc de test</summary>
    <div class="bench-body">
      <dl class="bench-facts" data-ref="benchFacts"></dl>
      <div class="bench-block">
        <h2>Imposer la valeur du dé</h2>
        <div class="bench-dice" data-ref="benchDice"></div>
      </div>
      <div class="bench-block">
        <h2 data-ref="warningsTitle">Avertissements</h2>
        <ul class="bench-list" data-ref="warnings"></ul>
      </div>
      <div class="bench-block">
        <h2>Journal des événements</h2>
        <ol class="bench-log" data-ref="log"></ol>
      </div>
      <div class="bench-block">
        <h2>État du moteur (getGameState)</h2>
        <pre class="bench-json" data-ref="json"></pre>
      </div>
    </div>
  </details>
`;

// Crée un élément. Les textes passent toujours par textContent : un « < » dans
// un JSON ne peut pas injecter de HTML dans la page.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key === 'vars') {
      for (const [name, cssValue] of Object.entries(value)) {
        node.style.setProperty(name, cssValue);
      }
    } else if (key.startsWith('on')) {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  node.append(...[].concat(children).filter(Boolean));
  return node;
}

function polar(index, size, radius) {
  const angle = (index / size) * 2 * Math.PI - Math.PI / 2; // case 0 en haut, sens horaire
  return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
}

const signed = (value) => (value > 0 ? `+${value}` : String(value)).replace('-', '−').replace('.', ',');

export function mountGameUI(game, root, options = {}) {
  const { testProfiles = [], dataLabel = '', pictoUrl = null } = options;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  root.classList.add('agora');
  root.innerHTML = SKELETON;
  const refs = Object.fromEntries([...root.querySelectorAll('[data-ref]')].map((node) => [node.dataset.ref, node]));

  const eventLog = [];
  let boardSignature = '';
  let cardSignature = '';
  let diceSpin = null;
  let diceFace = 1;
  let lastScreen = '';

  // -------------------------------------------------------------------------
  // Actions du joueur (tout passe par l'API du moteur)
  // -------------------------------------------------------------------------

  const roll = (forcedValue) => game.rollDice(forcedValue);
  const togglePause = () => (game.state === S.PAUSED ? game.resumeGame() : game.pauseGame());

  refs.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    game.initGame(refs.idInput.value);
  });
  refs.dice.addEventListener('click', () => roll());
  refs.pauseButton.addEventListener('click', togglePause);
  refs.endButton.addEventListener('click', () => game.endGame());
  refs.resetButton.addEventListener('click', () => {
    game.resetGame();
    refs.idInput.value = '';
    render();
  });

  for (const id of testProfiles) {
    refs.testProfiles.append(el('button', {
      type: 'button',
      class: 'chip',
      text: id,
      onclick: () => {
        refs.idInput.value = id;
        game.initGame(id);
      },
    }));
  }
  if (testProfiles.length > 0) {
    refs.testProfiles.prepend(el('span', { text: 'Profils fictifs de test :' }));
    refs.testProfiles.hidden = false;
  }

  for (let value = 1; value <= 6; value += 1) {
    refs.benchDice.append(el('button', { type: 'button', class: 'chip', text: String(value), onclick: () => roll(value) }));
  }

  function onKeydown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    // Sur un champ ou un bouton, le clavier garde son rôle habituel.
    if (event.target.closest?.('input, textarea, select, button, summary, a')) {
      return;
    }
    const key = event.key.toLowerCase();
    const question = game.getCurrentQuestion();
    if (game.state === S.QUESTION && question && /^[1-4]$/.test(key)) {
      const option = question.reponses[Number(key) - 1];
      if (option) {
        game.submitAnswer(option.id, question.id);
      }
    } else if (game.state === S.QUESTION && question?.informative && (key === 'enter' || key === ' ')) {
      event.preventDefault();
      game.continueGame();
    } else if (game.state === S.PLAYING && (key === 'd' || key === ' ')) {
      event.preventDefault();
      roll();
    } else if (key === 'p' && IN_GAME.includes(game.state)) {
      togglePause();
    }
  }
  document.addEventListener('keydown', onKeydown);

  // -------------------------------------------------------------------------
  // Barre du haut
  // -------------------------------------------------------------------------

  function renderTimer(remainingMs, state) {
    refs.timer.textContent = formatTime(remainingMs);
    refs.timer.classList.toggle('is-low', remainingMs <= 60_000);
    refs.timer.classList.toggle('is-paused', state === S.PAUSED);
    refs.timer.setAttribute('aria-label', `Temps restant : ${formatTime(remainingMs)}`);
  }

  function renderTopbar(state) {
    const inGame = IN_GAME.includes(state.state);
    refs.profileTag.hidden = !state.profile;
    refs.profileTag.textContent = state.profile ? `Profil ${state.profile.id}` : '';
    refs.timer.hidden = !(inGame || state.state === S.READY);
    renderTimer(state.timer.remainingMs, state.state);
    refs.pauseButton.hidden = !inGame;
    refs.pauseButton.textContent = state.state === S.PAUSED ? 'Reprendre' : 'Pause';
    refs.endButton.hidden = !inGame;
  }

  // -------------------------------------------------------------------------
  // Écran d'identifiant et écran de profil
  // -------------------------------------------------------------------------

  function renderLogin(state) {
    const loading = state.state === S.LOADING;
    refs.loginButton.disabled = loading;
    refs.loginButton.textContent = loading ? 'Chargement…' : 'Valider';
    refs.idInput.disabled = loading;
    refs.loginError.textContent = state.lastError?.message ?? '';
    refs.idInput.setAttribute('aria-invalid', state.lastError ? 'true' : 'false');
  }

  function renderProfile() {
    const profile = game.getProfileSummary();
    const meters = Object.entries(RIASEC_LABELS).map(([letter, label]) => {
      const value = Number(profile.riasec[letter]) || 0;
      return el('li', { class: 'meter' }, [
        el('span', { class: 'meter-label', text: label }),
        el('span', { class: 'meter-track' }, el('span', { class: 'meter-fill', vars: { '--value': `${Math.min(100, Math.max(0, value))}%` } })),
        el('span', { class: 'meter-value', text: String(value) }),
      ]);
    });
    const jobs = profile.champDesPossibles.map((job) => el('li', { text: job.titre ?? job.onet }));

    refs.profileScreen.replaceChildren(
      el('h1', { text: `Profil ${profile.id}` }),
      el('p', { class: 'lead', text: 'Voici ton point de départ. Tes réponses pendant la partie vont faire évoluer ton classement de métiers.' }),
      el('div', { class: 'profile-grid' }, [
        el('div', {}, [el('h2', { text: "Tes centres d'intérêt" }), el('ul', { class: 'meters' }, meters)]),
        el('div', {}, [
          el('h2', { text: 'Ton champ des possibles' }),
          jobs.length > 0 ? el('ul', { class: 'job-list' }, jobs) : el('p', { text: 'Aucun métier renseigné pour ce profil.' }),
        ]),
      ]),
      el('button', { type: 'button', class: 'button button--primary button--big', text: 'Commencer la partie', onclick: () => game.startGame() }),
    );
  }

  // -------------------------------------------------------------------------
  // Plateau, pion et dé
  // -------------------------------------------------------------------------

  function buildBoard(board) {
    const tileSize = Math.min(14, (2 * Math.PI * RING_RADIUS) / board.size - 2);
    refs.ring.style.setProperty('--tile', `${tileSize}%`);
    refs.ring.replaceChildren();

    for (const boardCase of board.cases) {
      const { x, y } = polar(boardCase.index, board.size, RING_RADIUS);
      refs.ring.append(el('div', {
        class: 'tile',
        'data-index': boardCase.index,
        title: `Case ${boardCase.number} : ${boardCase.label}`,
        vars: { '--x': `${x}%`, '--y': `${y}%`, '--type-color': boardCase.color, '--type-text': boardCase.textColor },
      }, el('span', { text: boardCase.symbol })));
    }
    const marks = [[board.start, 'Départ']];
    if (!board.loop) {
      marks.push([board.end, 'Arrivée']);
    }
    for (const [index, text] of marks) {
      const { x, y } = polar(index, board.size, RING_RADIUS + tileSize / 2 + 3.5);
      refs.ring.append(el('span', { class: 'ring-mark', text, vars: { '--x': `${x}%`, '--y': `${y}%` } }));
    }
    refs.ring.append(el('div', { class: 'pawn' }));

    const usedTypes = new Map(board.cases.map((boardCase) => [boardCase.type ?? 'neutre', boardCase]));
    refs.legend.replaceChildren(...[...usedTypes.values()].map((boardCase) => el('li', {}, [
      el('span', { class: 'legend-dot', text: boardCase.symbol, vars: { '--type-color': boardCase.color, '--type-text': boardCase.textColor } }),
      el('span', { text: boardCase.label }),
    ])));
  }

  function placePawn(position, board) {
    const { x, y } = polar(position, board.size, PAWN_RADIUS);
    const pawn = refs.ring.querySelector('.pawn');
    pawn.style.setProperty('--x', `${x}%`);
    pawn.style.setProperty('--y', `${y}%`);
    for (const tile of refs.ring.querySelectorAll('.tile')) {
      tile.classList.toggle('is-current', Number(tile.dataset.index) === position);
    }
    const current = board.cases[position];
    refs.ring.setAttribute('aria-label', `Plateau de ${board.size} cases. Ton pion est sur la case ${current.number} : ${current.label}.`);
  }

  function showDice(value) {
    diceFace = value;
    refs.dice.replaceChildren(...Array.from({ length: 9 }, (_, cell) => el('span', {
      class: DICE_PIPS[value]?.includes(cell + 1) ? 'pip is-on' : 'pip',
    })));
  }

  function stopDiceSpin() {
    clearInterval(diceSpin);
    diceSpin = null;
    refs.dice.classList.remove('is-rolling');
  }

  function startDiceSpin() {
    stopDiceSpin();
    if (reducedMotion) {
      return;
    }
    refs.dice.classList.add('is-rolling');
    diceSpin = setInterval(() => showDice(1 + Math.floor(Math.random() * 6)), 90);
  }

  function renderBoard(state) {
    const signature = state.board.cases.map((boardCase) => boardCase.type).join(',');
    if (signature !== boardSignature) {
      boardSignature = signature;
      buildBoard(state.board);
    }
    placePawn(state.position, state.board);
    if (!diceSpin) {
      showDice(state.lastRoll ?? diceFace);
    }
    refs.dice.disabled = state.state !== S.PLAYING;
    refs.diceStatus.textContent = {
      [S.PLAYING]: 'Lance le dé',
      [S.ROLLING]: 'Le dé roule…',
      [S.MOVING]: 'Ton pion avance…',
      [S.QUESTION]: 'Réponds à la carte',
      [S.PAUSED]: 'Partie en pause',
    }[state.state] ?? '';
  }

  // -------------------------------------------------------------------------
  // Carte : question, information, attente, pause
  // -------------------------------------------------------------------------

  function messageCard(title, text, action = null) {
    return el('div', { class: 'card card--message' }, [el('h1', { text: title }), text && el('p', { text }), action]);
  }

  function questionCard(question, state) {
    const answers = question.reponses.map((option, index) => el('button', {
      type: 'button',
      class: 'answer',
      'data-answer': option.id,
      'data-picto': option.picto,
      // Point d'entrée générique du moteur : la VR appelle exactement la même fonction.
      onclick: () => game.submitAnswer(option.id, question.id),
    }, [
      el('kbd', { text: String(index + 1) }),
      pictoUrl && option.picto ? el('img', { class: 'answer-picto', src: pictoUrl(option.picto), alt: '' }) : null,
      el('span', { text: frenchSpaces(option.texte) }),
    ]));

    const jobs = jobLine(question);
    return el('article', { class: 'card card--question', vars: { '--type-color': question.color, '--type-text': question.textColor } }, [
      el('header', { class: 'card-band' }, [
        el('span', { class: 'card-symbol', text: question.symbol }),
        el('span', { class: 'card-type', text: question.label }),
        jobs && el('span', { class: 'card-jobs', text: jobs }),
      ]),
      el('h1', { class: 'card-text', text: frenchSpaces(question.texte) }),
      question.informative
        ? el('button', { type: 'button', class: 'button button--primary button--big', text: 'Continuer', onclick: () => game.continueGame() })
        : el('div', { class: 'answers' }, answers),
      !question.informative && game.config.allowSkip
        ? el('button', { type: 'button', class: 'link-button', text: 'Passer cette question', onclick: () => game.skipQuestion() })
        : null,
      state.timer.timeUp ? el('p', { class: 'card-note', text: 'Le temps est écoulé : c\'est ta dernière carte.' }) : null,
    ]);
  }

  function renderCard(state) {
    const question = state.currentQuestion;
    const signature = [state.state, question?.id, state.timer.timeUp, state.lastRoll, state.turn].join('|');
    if (signature === cardSignature) {
      return;
    }
    cardSignature = signature;

    let card;
    if (state.state === S.PAUSED) {
      card = messageCard('Partie en pause', 'Le chrono est arrêté. Reprends quand tu veux.',
        el('button', { type: 'button', class: 'button button--primary button--big', text: 'Reprendre la partie', onclick: () => game.resumeGame() }));
    } else if (state.state === S.QUESTION && question) {
      card = questionCard(question, state);
    } else if (state.state === S.ROLLING) {
      card = messageCard('Le dé roule…', '');
    } else if (state.state === S.MOVING) {
      card = messageCard(state.lastRoll ? `Tu avances de ${state.lastRoll} case${state.lastRoll > 1 ? 's' : ''}` : 'Ton pion avance…', '');
    } else {
      card = messageCard('À toi de jouer', 'Lance le dé au centre du plateau pour avancer.');
    }
    refs.cardZone.replaceChildren(card);
  }

  // -------------------------------------------------------------------------
  // Résultats
  // -------------------------------------------------------------------------

  function rankingBlock(ranking) {
    if (!ranking.available) {
      return el('p', { class: 'notice', text: "Le module de classement (ranking.js, C1) n'est pas branché : le moteur ne calcule pas de classement à sa place. Tes réponses sont enregistrées ci-dessous." });
    }
    const block = [];
    if (Array.isArray(ranking.results) && ranking.results.length > 0) {
      block.push(el('ol', { class: 'ranking-list' }, ranking.results.map((item) => {
        const onet = typeof item === 'string' ? item : item?.onet;
        const title = item?.titre ?? item?.title ?? game.getJob(onet)?.titre ?? onet ?? JSON.stringify(item);
        const score = typeof item?.score === 'number' ? ` (${String(Math.round(item.score * 10) / 10).replace('.', ',')})` : '';
        return el('li', { text: `${title}${score}` });
      })));
    } else {
      block.push(el('pre', { class: 'bench-json', text: JSON.stringify(ranking.results, null, 2) ?? 'null' }));
    }
    if (typeof ranking.explanation === 'string') {
      block.push(el('p', { text: ranking.explanation }));
    } else if (ranking.explanation !== null && ranking.explanation !== undefined) {
      block.push(el('pre', { class: 'bench-json', text: JSON.stringify(ranking.explanation, null, 2) }));
    }
    return el('div', { class: 'ranking-block' }, block);
  }

  function renderResults() {
    const results = game.getResults();
    if (!results) {
      return;
    }
    const answered = results.history.filter((entry) => entry.answerId !== null).length;
    const moved = Object.entries(results.effectsTotal)
      .filter(([, value]) => value !== 0)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    refs.resultsScreen.replaceChildren(
      el('h1', { text: 'Partie terminée' }),
      el('p', { class: 'lead', text: END_REASONS[results.reason] ?? '' }),
      el('dl', { class: 'stats' }, [
        el('div', {}, [el('dt', { text: 'Lancers de dé' }), el('dd', { text: String(results.turns) })]),
        el('div', {}, [el('dt', { text: 'Réponses données' }), el('dd', { text: String(answered) })]),
        el('div', {}, [el('dt', { text: 'Temps de jeu' }), el('dd', { text: formatTime(results.durationMs) })]),
      ]),
      el('h2', { text: 'Ton classement de métiers' }),
      rankingBlock(results.ranking),
      el('h2', { text: 'Ce que tes réponses ont fait bouger' }),
      moved.length > 0
        ? el('ul', { class: 'effects' }, moved.map(([attribute, value]) => el('li', {}, [
          el('span', { text: ATTRIBUTE_LABELS[attribute] ?? attribute }),
          el('span', { class: value > 0 ? 'effect is-up' : 'effect is-down', text: signed(value) }),
        ])))
        : el('p', { text: 'Aucune réponse enregistrée pendant cette partie.' }),
      el('h2', { text: 'Tes réponses' }),
      results.history.length > 0
        ? el('ol', { class: 'history' }, results.history.map((entry) => el('li', {}, [
          el('span', { class: 'history-question', text: frenchSpaces(entry.questionTexte) }),
          el('span', { class: 'history-answer', text: entry.answerTexte ? frenchSpaces(entry.answerTexte) : (entry.skipped ? 'Question passée' : 'Carte lue') }),
        ])))
        : el('p', { text: "Tu n'as tiré aucune carte." }),
      el('button', {
        type: 'button',
        class: 'button button--primary button--big',
        text: 'Nouvelle partie',
        onclick: () => {
          game.resetGame();
          refs.idInput.value = '';
          render();
        },
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Banc de test
  // -------------------------------------------------------------------------

  function renderBench(state) {
    const count = state.warnings.length;
    refs.benchSummary.textContent = count > 0
      ? `Banc de test (${count} avertissement${count > 1 ? 's' : ''} à lire)`
      : 'Banc de test';
    if (!refs.bench.open) {
      return;
    }
    const currentCase = state.currentCase;
    const facts = [
      ['État', state.state + (state.pausePending ? ' (pause demandée)' : '')],
      ['Case', currentCase ? `n°${currentCase.number}, ${currentCase.label}` : 'aucune'],
      ['Lancers', String(state.turn)],
      ['Tours de plateau', String(state.lap)],
      ['Dernier dé', state.lastRoll === null ? 'aucun' : String(state.lastRoll)],
      ['Cartes vues', state.content ? `${state.content.seen} sur ${state.content.total}` : 'aucune'],
      ['Ranking (C1)', state.ranking.available ? `branché, ${state.ranking.failures} erreur(s)` : 'non branché'],
      ['Données', dataLabel || game.config.dataPath],
    ];
    refs.benchFacts.replaceChildren(...facts.map(([term, value]) => el('div', {}, [el('dt', { text: term }), el('dd', { text: value })])));

    for (const button of refs.benchDice.children) {
      button.disabled = state.state !== S.PLAYING;
    }
    refs.warningsTitle.textContent = `Avertissements (${state.warnings.length})`;
    refs.warnings.replaceChildren(...(state.warnings.length > 0
      ? state.warnings.map((warning) => el('li', { text: warning }))
      : [el('li', { text: 'Aucun.' })]));
    refs.log.replaceChildren(...eventLog.map((line) => el('li', {}, [el('strong', { text: line.name }), el('span', { text: line.detail })])));
    refs.json.textContent = JSON.stringify({ ...state, board: `[${state.board?.size ?? 0} cases]` }, null, 2);
  }

  // -------------------------------------------------------------------------
  // Rendu général et écoute du moteur
  // -------------------------------------------------------------------------

  function render() {
    const state = game.getGameState();
    const screen = IN_GAME.includes(state.state) ? 'play'
      : state.state === S.READY ? 'profile'
      : state.state === S.FINISHED ? 'results'
      : 'login';

    refs.loginScreen.hidden = screen !== 'login';
    refs.profileScreen.hidden = screen !== 'profile';
    refs.playScreen.hidden = screen !== 'play';
    refs.resultsScreen.hidden = screen !== 'results';
    renderTopbar(state);

    if (screen === 'login') {
      renderLogin(state);
    } else if (screen === 'profile') {
      renderProfile();
    } else if (screen === 'play') {
      renderBoard(state);
      renderCard(state);
    } else if (screen !== lastScreen) {
      renderResults();
    }
    if (screen !== 'play') {
      cardSignature = '';
      stopDiceSpin();
    }
    if (screen === 'login' && state.state !== S.LOADING && (screen !== lastScreen || state.lastError)) {
      refs.idInput.focus();
      refs.idInput.select();
    }
    lastScreen = screen;
    renderBench(state);
  }

  const stopListening = game.on('*', (name, payload) => {
    if (name === 'timer:tick') {
      renderTimer(payload.remainingMs, game.state);
      return;
    }
    eventLog.unshift({ name, detail: JSON.stringify(payload).slice(0, 160) });
    eventLog.length = Math.min(eventLog.length, 40);

    if (name === 'dice:rolling') {
      startDiceSpin();
    } else if (name === 'dice:rolled') {
      stopDiceSpin();
      showDice(payload.value);
    }
    render();
  });
  refs.bench.addEventListener('toggle', render);

  render();

  return {
    render,
    destroy() {
      stopListening();
      stopDiceSpin();
      document.removeEventListener('keydown', onKeydown);
      root.replaceChildren();
    },
  };
}
