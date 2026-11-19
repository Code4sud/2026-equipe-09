// Affichage VR (A-Frame) du moteur : carte et réponses, dé, chrono, pause.
//
// Chaque panneau est un plan texturé par un <canvas>. Le texte est dessiné avec
// les polices du système : les accents français s'affichent sans police MSDF à
// générer. Chaque bouton est une entité A-Frame qui porte la classe « clickable »
// et réagit à l'événement `click` : clic souris, curseur à fusion (regard
// maintenu, système de E1) et manettes aboutissent tous à la même fonction du moteur.
//
// Utilisation (A-Frame déjà chargé) :
//   import { attachVrUI } from './ui/vrUI.js';
//   const ui = attachVrUI(game, document.querySelector('#agora-ui'));
// où #agora-ui est une <a-entity> placée face au joueur, à environ 2,4 m.
// Le raycaster du curseur doit viser la classe : raycaster="objects: .clickable".

import { STATES } from '../engine/config.js';
import { formatTime, frenchSpaces, jobLine } from './typography.js';

const S = STATES;
const PX_PER_METER = 512;
const FONT = "'Segoe UI', 'Noto Sans', Roboto, 'Helvetica Neue', Arial, sans-serif";
const INK = '#1D2433';
const WHITE = '#FFFFFF';
const ALERT = '#B3261E';

// Disposition, en mètres, par rapport à l'entité d'ancrage.
const LAYOUT = {
  hud: { width: 1.5, height: 0.26, x: -0.25, y: 0.87 },
  pause: { width: 0.44, height: 0.26, x: 0.78, y: 0.87 },
  card: { width: 2.0, height: 0.95, x: 0, y: 0.22 },
  button: { width: 0.97, height: 0.3 },
  rows: [-0.45, -0.8],
  columns: [-0.515, 0.515],
};

// ---------------------------------------------------------------------------
// Dessin sur canvas (fonctions pures, testables sans A-Frame)
// ---------------------------------------------------------------------------

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of frenchSpaces(text).split(/[ \n\t]+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

// Plus grande taille de police pour laquelle le texte tient dans la boîte.
function fitText(ctx, text, { maxWidth, maxHeight, maxSize, minSize, weight = 800, lineHeight = 1.22 }) {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (wrapText(ctx, text, maxWidth).length * size * lineHeight <= maxHeight) {
      break;
    }
    size -= 2;
  }
  ctx.font = `${weight} ${size}px ${FONT}`;
  return { lines: wrapText(ctx, text, maxWidth), lineHeight: size * lineHeight };
}

function ellipsize(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

function drawLines(ctx, lines, x, top, lineHeight) {
  lines.forEach((line, index) => ctx.fillText(line, x, top + (index + 0.5) * lineHeight));
}

// La carte : bandeau de la couleur du type, puis le texte en très grand.
export function drawCard(canvas, { band, symbol = '', color = INK, textColor = WHITE, jobs = '', text, note = '' }) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const pad = 48;
  const bandHeight = 100;
  const middle = bandHeight / 2 + 2;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  roundedRect(ctx, 0, 0, width, height, 40);
  ctx.clip();
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, bandHeight);
  ctx.restore();

  ctx.fillStyle = textColor;
  ctx.strokeStyle = textColor;
  ctx.textBaseline = 'middle';
  let x = pad;
  if (symbol) {
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x + 30, bandHeight / 2, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `800 34px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(symbol, x + 30, middle);
    x += 82;
  }
  ctx.textAlign = 'left';
  ctx.font = `800 46px ${FONT}`;
  ctx.fillText(band, x, middle);
  const afterBand = x + ctx.measureText(band).width + 40;
  if (jobs) {
    ctx.font = `600 34px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(ellipsize(ctx, jobs, width - pad - afterBand), width - pad, middle);
  }

  const noteHeight = note ? 56 : 0;
  const box = { x: pad, y: bandHeight + 26, width: width - 2 * pad, height: height - bandHeight - 52 - noteHeight };
  const fitted = fitText(ctx, text, { maxWidth: box.width, maxHeight: box.height, maxSize: 66, minSize: 34 });
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  drawLines(ctx, fitted.lines, box.x, box.y + (box.height - fitted.lines.length * fitted.lineHeight) / 2, fitted.lineHeight);

  if (note) {
    ctx.fillStyle = ALERT;
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(note, pad, height - 42);
  }
}

// Un bouton. Survolé (regard ou souris posés dessus), il se remplit de sa couleur.
export function drawButton(canvas, { label, badge = '', color = INK, textColor = WHITE }, hovered = false) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const border = 8;

  ctx.clearRect(0, 0, width, height);
  roundedRect(ctx, border / 2, border / 2, width - border, height - border, 34);
  ctx.fillStyle = hovered ? color : WHITE;
  ctx.fill();
  ctx.lineWidth = border;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.textBaseline = 'middle';
  let x = 34;
  if (badge) {
    ctx.fillStyle = hovered ? textColor : color;
    ctx.beginPath();
    ctx.arc(x + 30, height / 2, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hovered ? color : textColor;
    ctx.font = `800 34px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(badge, x + 30, height / 2 + 2);
    x += 82;
  }
  const fitted = fitText(ctx, label, {
    maxWidth: width - x - 30,
    maxHeight: height - 34,
    maxSize: 44,
    minSize: 24,
    weight: 700,
    lineHeight: 1.15,
  });
  ctx.fillStyle = hovered ? textColor : INK;
  ctx.textAlign = badge ? 'left' : 'center';
  drawLines(ctx, fitted.lines, badge ? x : width / 2, (height - fitted.lines.length * fitted.lineHeight) / 2, fitted.lineHeight);
}

// Le chrono : blanc en jeu, grisé en pause, rosé pendant la dernière minute.
export function drawHud(canvas, { time, low = false, paused = false }) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  roundedRect(ctx, 0, 0, width, height, 34);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.fillStyle = paused ? '#AEB7C6' : low ? '#FFB4A9' : WHITE;
  ctx.font = `800 92px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(time, width / 2, height / 2 + 4);
}

// ---------------------------------------------------------------------------
// Ce qu'il faut afficher pour un état donné du moteur
// ---------------------------------------------------------------------------

function cardContent(state) {
  const question = state.currentQuestion;
  if (state.state === S.QUESTION && question) {
    return {
      band: question.label,
      symbol: question.symbol,
      color: question.color,
      textColor: question.textColor,
      jobs: jobLine(question),
      text: question.texte,
      note: state.timer.timeUp ? "Temps écoulé : c'est ta dernière carte." : '',
    };
  }
  const steps = state.lastRoll;
  const text = {
    [S.IDLE]: 'En attente de ton identifiant.',
    [S.LOADING]: 'Chargement…',
    [S.ERROR]: state.lastError?.message ?? 'Une erreur est survenue.',
    [S.READY]: `Profil ${state.profile?.id ?? ''} chargé. On commence ?`,
    [S.PLAYING]: 'À toi de jouer : lance le dé.',
    [S.ROLLING]: 'Le dé roule…',
    [S.MOVING]: steps ? `Tu avances de ${steps} case${steps > 1 ? 's' : ''}.` : 'Ton pion avance…',
    [S.PAUSED]: 'Partie en pause.',
    [S.FINISHED]: 'Partie terminée. Tes résultats arrivent.',
  }[state.state] ?? '';
  return { band: 'Agora Explorer', text };
}

// Les boutons à proposer : libellé, style et action (toujours une fonction du moteur).
function buttonSpecs(game, state, { showSkip }) {
  const question = state.currentQuestion;
  switch (state.state) {
    case S.READY:
      return [{ label: 'Commencer la partie', onClick: () => game.startGame() }];
    case S.PLAYING:
      return [{ label: 'Lancer le dé', onClick: () => game.rollDice() }];
    case S.PAUSED:
      return [{ label: 'Reprendre', onClick: () => game.resumeGame() }];
    case S.QUESTION: {
      if (!question) {
        return [];
      }
      if (question.informative) {
        return [{ label: 'Continuer', color: question.color, textColor: question.textColor, onClick: () => game.continueGame() }];
      }
      const answers = question.reponses.map((option, index) => ({
        label: option.texte,
        badge: String(index + 1),
        color: question.color,
        textColor: question.textColor,
        // Même point d'entrée que sur PC : le moteur ignore d'où vient la sélection.
        onClick: () => game.submitAnswer(option.id, question.id),
      }));
      if (showSkip && game.config.allowSkip && answers.length < 4) {
        answers.push({ label: 'Passer', onClick: () => game.skipQuestion() });
      }
      return answers;
    }
    default:
      return [];
  }
}

// Place 1 à 4 boutons : deux par rangée, un bouton seul est centré.
function buttonPositions(count) {
  const [row1, row2] = LAYOUT.rows;
  const [left, right] = LAYOUT.columns;
  return [
    [],
    [[0, row1]],
    [[left, row1], [right, row1]],
    [[left, row1], [right, row1], [0, row2]],
    [[left, row1], [right, row1], [left, row2], [right, row2]],
  ][Math.min(count, 4)];
}

// ---------------------------------------------------------------------------
// Branchement A-Frame
// ---------------------------------------------------------------------------

export function attachVrUI(game, anchorEl, options = {}) {
  const AFRAME = globalThis.AFRAME;
  if (!AFRAME?.THREE) {
    throw new Error("vrUI.js : A-Frame doit être chargé avant d'appeler attachVrUI().");
  }
  if (!anchorEl) {
    throw new Error("vrUI.js : entité d'ancrage introuvable (ex. <a-entity id=\"agora-ui\">).");
  }
  const THREE = AFRAME.THREE;
  // hudText(state) : texte du bandeau à la place du chrono (ex. « Tour 3 / 15 »).
  const { clickableClass = 'clickable', showSkip = false, hudText = null } = options;

  function createPanel({ width, height, x, y }, draw, onClick = null) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * PX_PER_METER);
    canvas.height = Math.round(height * PX_PER_METER);
    draw(canvas, false);

    const texture = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in texture) {
      texture.colorSpace = THREE.SRGBColorSpace ?? 'srgb';
    } else if (THREE.sRGBEncoding) {
      texture.encoding = THREE.sRGBEncoding; // anciennes versions de three.js
    }
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);

    const entity = document.createElement('a-entity');
    entity.setAttribute('position', `${x} ${y} 0`);
    const panel = {
      entity,
      canvas,
      redraw(hovered = false) {
        draw(canvas, hovered);
        texture.needsUpdate = true;
      },
      dispose() {
        entity.parentNode?.removeChild(entity);
        texture.dispose();
        material.dispose();
        geometry.dispose();
      },
    };

    if (onClick) {
      entity.classList.add(clickableClass);
      entity.addEventListener('click', onClick);
      entity.addEventListener('mouseenter', () => panel.redraw(true));
      entity.addEventListener('mouseleave', () => panel.redraw(false));
    }
    anchorEl.appendChild(entity);
    const setMesh = () => entity.setObject3D('mesh', mesh);
    if (entity.hasLoaded) {
      setMesh();
    } else {
      entity.addEventListener('loaded', setMesh, { once: true });
    }
    return panel;
  }

  let state = game.getGameState();
  let shownTime = '';
  let signature = '';
  let buttons = [];

  const hudData = () => ({
    time: hudText ? hudText(state) : formatTime(state.timer.remainingMs),
    low: !hudText && state.timer.remainingMs <= 60_000,
    paused: state.state === S.PAUSED,
  });
  const hud = createPanel(LAYOUT.hud, (canvas) => drawHud(canvas, hudData()));
  const card = createPanel(LAYOUT.card, (canvas) => drawCard(canvas, cardContent(state)));

  function rebuildButtons() {
    buttons.forEach((button) => button.dispose()); // un bouton retiré de la scène n'est plus cliquable
    const specs = buttonSpecs(game, state, { showSkip });
    const positions = buttonPositions(specs.length);
    buttons = specs.slice(0, 4).map((spec, index) => createPanel(
      { ...LAYOUT.button, x: positions[index][0], y: positions[index][1] },
      (canvas, hovered) => drawButton(canvas, spec, hovered),
      spec.onClick,
    ));
    if ([S.PLAYING, S.ROLLING, S.MOVING, S.QUESTION].includes(state.state)) {
      const pause = { label: 'Pause' };
      buttons.push(createPanel(LAYOUT.pause, (canvas, hovered) => drawButton(canvas, pause, hovered), () => game.pauseGame()));
    }
  }

  function refresh() {
    state = game.getGameState();
    const next = [state.state, state.currentQuestion?.id, state.turn, state.timer.timeUp, state.lastError?.code].join('|');
    if (next === signature) {
      return;
    }
    signature = next;
    shownTime = hudData().time;
    hud.redraw();
    card.redraw();
    rebuildButtons();
  }

  const stopListening = game.on('*', (name, payload) => {
    if (name === 'timer:tick') {
      if (hudText) {
        return;
      }
      const time = formatTime(payload.remainingMs);
      if (time !== shownTime) {
        shownTime = time;
        state = game.getGameState();
        hud.redraw();
      }
      return;
    }
    refresh();
  });
  refresh();

  return {
    refresh,
    destroy() {
      stopListening();
      [hud, card, ...buttons].forEach((panel) => panel.dispose());
      buttons = [];
    },
  };
}
