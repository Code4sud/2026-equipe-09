// Choix de la carte (question, situation, information...) quand le pion arrive
// sur une case. Une « carte » est une entrée de cases.json.
//
// Ordre de préférence, pour un type de case donné :
//   1. une carte jamais vue et compatible avec les métiers du profil
//   2. une carte jamais vue
//   3. s'il n'y a plus de contenu neuf : la carte la moins souvent vue
// Si le type n'a aucun contenu, on renvoie une carte de secours informative :
// la partie ne se bloque jamais.

import { CASE_TYPES } from './config.js';
import { profileJobCodes } from './dataLoader.js';

export function createQuestionBank({ cases, profile, metiersByOnet = new Map(), random = Math.random, chooser = null }) {
  const profileJobs = profileJobCodes(profile);
  const byType = new Map();
  const byId = new Map();
  const seenCount = new Map();
  const lastIdByType = new Map();

  for (const card of cases) {
    if (!byType.has(card.type)) {
      byType.set(card.type, []);
    }
    byType.get(card.type).push(card);
    byId.set(card.id, card);
  }

  const timesSeen = (card) => seenCount.get(card.id) ?? 0;

  function targetJobs(card) {
    const targets = [...card.metiers_cibles];
    if (card.type === 'passerelle') {
      for (const code of [card.de, card.vers]) {
        if (typeof code === 'string' && code !== '') {
          targets.push(code);
        }
      }
    }
    return targets;
  }

  function isCompatible(card) {
    if (!CASE_TYPES[card.type].matchProfile || profileJobs.size === 0) {
      return true;
    }
    const targets = targetJobs(card);
    return targets.length === 0 || targets.some((code) => profileJobs.has(code));
  }

  function bestCandidates(pool, type) {
    // On évite de resservir la carte qui vient de passer quand il y a un autre choix.
    const lastId = lastIdByType.get(type);
    const usable = pool.length > 1 ? pool.filter((card) => card.id !== lastId) : pool;
    const fewestViews = Math.min(...usable.map(timesSeen));
    const leastSeen = usable.filter((card) => timesSeen(card) === fewestViews);
    const compatible = leastSeen.filter(isCompatible);
    return compatible.length > 0 ? compatible : leastSeen;
  }

  // Le module de ranking peut proposer la carte la plus utile parmi les candidates.
  function askChooser(candidates) {
    if (typeof chooser !== 'function') {
      return null;
    }
    const choice = chooser(candidates.map((card) => JSON.parse(JSON.stringify(card))));
    const id = typeof choice === 'string' ? choice : choice?.id;
    return candidates.find((card) => card.id === id) ?? null;
  }

  function resolveJob(onet) {
    if (typeof onet !== 'string' || onet === '') {
      return null;
    }
    return { onet, titre: metiersByOnet.get(onet)?.titre ?? null };
  }

  // Ce que l'interface reçoit : de quoi afficher la carte, sans les effets
  // (pour ne pas risquer de les montrer au joueur).
  function toView(card, { generic = false } = {}) {
    const meta = CASE_TYPES[card.type];
    const hasBridge = card.type === 'passerelle' && (resolveJob(card.de) || resolveJob(card.vers));
    return {
      id: card.id,
      type: card.type,
      label: meta.label,
      color: meta.color,
      textColor: meta.textColor,
      symbol: meta.symbol,
      texte: card.texte,
      reponses: card.reponses.map((answer) => ({
        id: answer.id,
        texte: answer.texte,
        picto: answer.picto ?? null,
      })),
      informative: card.reponses.length === 0,
      metiers: card.metiers_cibles.map(resolveJob).filter(Boolean),
      passerelle: hasBridge ? { de: resolveJob(card.de), vers: resolveJob(card.vers) } : null,
      generic,
      alreadySeen: timesSeen(card) > 0,
    };
  }

  function pick(type) {
    if (!CASE_TYPES[type]) {
      return null; // case neutre ou type inconnu : rien à afficher
    }
    const pool = byType.get(type) ?? [];
    if (pool.length === 0) {
      return toView(
        { id: `generique-${type}`, type, texte: CASE_TYPES[type].fallbackText, metiers_cibles: [], reponses: [] },
        { generic: true },
      );
    }
    const candidates = bestCandidates(pool, type);
    const card = askChooser(candidates) ?? candidates[Math.floor(random() * candidates.length)] ?? candidates[0];
    const view = toView(card);
    seenCount.set(card.id, timesSeen(card) + 1);
    lastIdByType.set(type, card.id);
    return view;
  }

  // Réponse complète (avec ses effets) d'une carte, ou null si elle n'existe pas.
  function findAnswer(cardId, answerId) {
    const card = byId.get(cardId);
    return card?.reponses.find((answer) => answer.id === String(answerId)) ?? null;
  }

  function stats() {
    const perType = {};
    for (const type of Object.keys(CASE_TYPES)) {
      const pool = byType.get(type) ?? [];
      perType[type] = { total: pool.length, seen: pool.filter((card) => timesSeen(card) > 0).length };
    }
    const total = cases.length;
    const seen = cases.filter((card) => timesSeen(card) > 0).length;
    return { total, seen, remaining: total - seen, perType };
  }

  return {
    pick,
    findAnswer,
    stats,
    countForType: (type) => (byType.get(type) ?? []).length,
    allSeen: () => cases.length > 0 && cases.every((card) => timesSeen(card) > 0),
  };
}
