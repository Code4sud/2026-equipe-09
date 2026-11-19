// Le plateau : une liste ordonnée de cases typées, et le calcul des déplacements.
// La disposition vient de la configuration (config.js > board) : on peut changer
// le plateau sans toucher au moteur.

import { CASE_TYPES, NEUTRAL_CASE } from './config.js';
import { GameError } from './dataLoader.js';

export function createBoard(boardConfig, warnings = []) {
  const entries = Array.isArray(boardConfig?.cases) ? boardConfig.cases : [];
  if (entries.length < 2) {
    throw new GameError('BOARD_INVALID', 'Le plateau doit contenir au moins 2 cases (15 à 18 attendues).');
  }
  if (entries.length < 15 || entries.length > 18) {
    warnings.push(`Plateau : ${entries.length} cases configurées (15 à 18 attendues).`);
  }

  const cases = entries.map((entry, index) => {
    const type = typeof entry === 'string' ? entry : entry?.type;
    const meta = CASE_TYPES[type];
    if (!meta) {
      warnings.push(`Plateau : case n°${index + 1} de type inconnu « ${type} », elle sera neutre.`);
    }
    const look = meta ?? NEUTRAL_CASE;
    return Object.freeze({
      index,
      number: index + 1,
      type: meta ? type : null, // null = case neutre : rien ne s'y passe
      label: look.label,
      color: look.color,
      textColor: look.textColor,
      symbol: look.symbol,
    });
  });

  const size = cases.length;
  const loop = boardConfig.loop !== false;
  const start = Number.isInteger(boardConfig.start) && boardConfig.start >= 0 && boardConfig.start < size
    ? boardConfig.start
    : 0;

  // Avance case par case pour que l'interface puisse animer chaque pas.
  function computeMove(from, steps) {
    const path = [];
    let position = from;
    let laps = 0;
    for (let step = 0; step < steps; step += 1) {
      if (!loop && position === size - 1) {
        break; // plateau en ligne : on ne dépasse pas la dernière case
      }
      position = loop ? (position + 1) % size : position + 1;
      if (loop && position === start) {
        laps += 1;
      }
      path.push(position);
    }
    return { from, to: position, path, laps };
  }

  return {
    cases,
    size,
    loop,
    start,
    end: loop ? null : size - 1,
    getCase: (index) => cases[index] ?? null,
    computeMove,
  };
}
