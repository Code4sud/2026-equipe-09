// Pont entre le moteur (E2) et ranking.js (C1).
//
// Le moteur ne calcule AUCUN score : il transmet les effets des réponses et
// relaie ce que le module de C1 renvoie. Tant que ranking.js n'est pas branché,
// la partie se joue normalement et les résultats indiquent `available: false`.
//
// Contrat attendu (toutes les fonctions sont optionnelles et synchrones) :
//   ranking.init(metiers, profil)            appelée au début de chaque partie
//   ranking.applyAnswer(effets, contexte)    appelée à chaque réponse
//   ranking.getResults()                     classement courant
//   ranking.getExplanation()                 explication du classement
//   ranking.selectBestQuestion(candidates, contexte)   carte (ou id) à poser
//
// Si l'API réelle de C1 porte d'autres noms, c'est ICI qu'on fait la traduction
// (ou en passant à createGame un petit objet qui expose ces cinq fonctions).

export const RANKING_METHODS = Object.freeze([
  'init',
  'applyAnswer',
  'getResults',
  'getExplanation',
  'selectBestQuestion',
]);

export function createRankingAdapter(rankingModule, onWarning = () => {}) {
  const ranking = rankingModule ?? null;
  const isCallable = (method) => typeof ranking?.[method] === 'function';
  // Branché = expose au moins une des fonctions du contrat. (Un simple
  // <div id="ranking"> crée aussi un `window.ranking` : ce n'est pas un module.)
  const available = RANKING_METHODS.some(isCallable);
  const alreadyWarned = new Set();
  let failures = 0;

  const has = (method) => available && isCallable(method);

  // Un module de ranking absent, incomplet ou qui plante ne doit jamais arrêter la partie.
  function call(method, args) {
    if (!has(method)) {
      return null;
    }
    try {
      const result = ranking[method](...args);
      return result === undefined ? null : result;
    } catch (error) {
      failures += 1;
      if (!alreadyWarned.has(method)) {
        alreadyWarned.add(method);
        onWarning(`ranking.${method}() a levé une erreur : ${error?.message ?? error}`);
      }
      return null;
    }
  }

  return {
    available,
    has,
    init: (metiers, profil) => call('init', [metiers, profil]),
    applyAnswer: (effets, contexte) => call('applyAnswer', [effets, contexte]),
    getResults: () => call('getResults', []),
    getExplanation: () => call('getExplanation', []),
    selectBestQuestion: (candidates, contexte) => call('selectBestQuestion', [candidates, contexte]),
    status: () => ({
      available,
      methods: Object.fromEntries(RANKING_METHODS.map((method) => [method, has(method)])),
      failures,
    }),
  };
}
