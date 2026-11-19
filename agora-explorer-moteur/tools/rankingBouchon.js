// BOUCHON DE TEST, pas un ranking.
// Il respecte le contrat attendu par le moteur (voir engine/rankingAdapter.js)
// pour vérifier le branchement, mais ne calcule aucun score de métier :
// l'algorithme de classement est celui de C1, dans ranking.js.
//
// Essai : pc.html?ranking=bouchon

const recu = { init: 0, applyAnswer: 0, effets: {} };

export default {
  init(metiers, profil) {
    recu.init += 1;
    recu.applyAnswer = 0;
    recu.effets = {};
    console.info(`[bouchon ranking] init : ${metiers.length} métiers, profil ${profil.id}`);
  },

  applyAnswer(effets, contexte) {
    recu.applyAnswer += 1;
    for (const [attribut, valeur] of Object.entries(effets)) {
      recu.effets[attribut] = (recu.effets[attribut] ?? 0) + valeur;
    }
    console.info('[bouchon ranking] applyAnswer', effets, contexte);
  },

  getResults() {
    return {
      bouchon: true,
      message: 'Bouchon de test : aucun classement calculé. Voici seulement ce que le moteur a transmis.',
      appels_applyAnswer: recu.applyAnswer,
      effets_recus: { ...recu.effets },
    };
  },

  getExplanation() {
    return 'Explication fournie par le bouchon de test (à remplacer par ranking.getExplanation() de C1).';
  },
};
