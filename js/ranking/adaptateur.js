// Adaptateur entre le moteur de jeu (E2) et ranking.js (C1).
//
// Le moteur appelle : init(metiers, profil), applyAnswer(effets), selectBestQuestion(candidates),
// getResults(), getExplanation() (voir agora-explorer-moteur/engine/rankingAdapter.js).
// ranking.js expose : new RankingEngine(options).init(liste, classementPsy), applyAnswer(impact),
// getNextQuestion(questions, dejaPosees), getRanking().
// Ce fichier traduit les noms et les formats, sans toucher à l'algorithme de C1.
//
// Sortie de getResults() (lue par le tableau de résultats, E3) : un tableau trié de
//   { onet, titre, rang, categorie: 'tres_proche' | 'a_explorer' | 'plus_eloigne', score, raisons: [] }

// Libellés des 12 attributs du projet (ranking.js n'en connaît que 8 par défaut).
const LIBELLES = {
  exterieur: { def: 'le travail en extérieur', de: 'de travail en extérieur' },
  travail_equipe: { def: 'le travail en équipe', de: 'de travail en équipe' },
  contact_public: { def: 'le contact avec le public', de: 'de contact avec le public' },
  activite_physique: { def: "l'activité physique", de: "d'activité physique" },
  travail_manuel: { def: 'le travail manuel', de: 'de travail manuel' },
  horaires_decales: { def: 'les horaires décalés', de: "d'horaires décalés" },
  creativite: { def: 'la créativité', de: 'de créativité' },
  analyse_chiffres: { def: "l'analyse et les chiffres", de: "d'analyse et de chiffres" },
  aide_aux_autres: { def: "l'aide aux autres", de: "d'aide aux autres" },
  technologie: { def: 'la technologie', de: 'de technologie' },
  encadrement: { def: "l'encadrement d'une équipe", de: "d'encadrement" },
  deplacements: { def: 'les déplacements', de: 'de déplacements' }
};

function cleCategorie(libelle, CATEGORIES) {
  if (libelle === CATEGORIES.PROCHE) return 'tres_proche';
  if (libelle === CATEGORIES.ELOIGNE) return 'plus_eloigne';
  return 'a_explorer';
}

// « Bien classé car … . Point de vigilance : … . » -> une raison par phrase.
function decouperExplication(texte) {
  if (typeof texte !== 'string' || texte.trim() === '') return [];
  const morceaux = texte.split(/(?<=\.)\s+/);
  const raisons = [];
  let i = 0;
  while (i < morceaux.length) {
    const phrase = morceaux[i].trim();
    if (phrase !== '') raisons.push(phrase);
    i++;
  }
  return raisons.slice(0, 3);
}

// Raisons courtes pour la fiche (« Tu aimes le travail en équipe ») et un point à savoir,
// à partir des contributions calculées par ranking.js (mêmes règles que son explication).
function raisonsCourtes(moteur, code, favori) {
  const m = moteur.metiers.find((x) => x.code === code);
  const raisons = [];
  let vigilance = '';
  if (m) {
    const seuil = moteur.options.seuilExplication;
    const analyses = Object.keys(moteur.preferences)
      .map((attr) => ({ attr, contrib: moteur._contribution(m, attr), pref: moteur.preferences[attr], fort: moteur._centre(m, attr) > 0 }))
      .filter((a) => Math.abs(a.contrib) >= seuil);
    const positifs = analyses.filter((a) => a.contrib > 0).sort((a, b) => b.contrib - a.contrib);
    let i = 0;
    while (i < positifs.length && raisons.length < 2) {
      const a = positifs[i];
      const l = moteur._label(a.attr);
      raisons.push(a.pref > 0 ? 'Tu aimes ' + l.def : 'Peu ' + l.de + ', comme tu préfères');
      i++;
    }
    const negatifs = analyses.filter((a) => a.contrib < 0).sort((a, b) => a.contrib - b.contrib);
    if (negatifs.length > 0) {
      const a = negatifs[0];
      const l = moteur._label(a.attr);
      vigilance = a.pref < 0 ? 'Beaucoup ' + l.de + ' dans ce métier.' : 'Peu ' + l.de + ' dans ce métier.';
    }
  }
  if (favori && raisons.length < 2) raisons.unshift('Tu l’avais choisi avec le psychologue');
  return { raisons: raisons.slice(0, 2), vigilance };
}

export function creerRankingC1(module, options = {}) {
  const { RankingEngine, CATEGORIES } = module;
  let moteur = null;
  let titres = new Map();
  let favoris = [];

  return {
    // Seuls les métiers du champ des possibles du profil sont classés.
    init(metiers, profil) {
      const parCode = new Map();
      let i = 0;
      while (i < metiers.length) {
        if (metiers[i] && metiers[i].onet) parCode.set(metiers[i].onet, metiers[i]);
        i++;
      }
      const liste = [];
      const vus = new Set();
      titres = new Map();
      favoris = (profil && profil.classement_entretien) || [];
      const champ = (profil && profil.champ_des_possibles) || [];
      i = 0;
      while (i < champ.length) {
        const onet = typeof champ[i] === 'string' ? champ[i] : champ[i] && champ[i].onet;
        if (onet && !vus.has(onet)) {
          vus.add(onet);
          const m = parCode.get(onet);
          const titre = (m && m.titre) || onet;
          titres.set(onet, titre);
          // Attributs absents (null) : ranking.js les traite comme neutres (0,5).
          liste.push({ code: onet, nom: titre, attributs: (m && m.attributs) || {} });
        }
        i++;
      }
      if (liste.length === 0) {
        moteur = null;
        return;
      }
      moteur = new RankingEngine({ ...options, labels: { ...LIBELLES, ...(options.labels || {}) } })
        .init(liste, (profil && profil.classement_entretien) || []);
    },

    applyAnswer(effets) {
      if (moteur && effets && Object.keys(effets).length > 0) moteur.applyAnswer(effets);
    },

    // Parmi les cartes candidates (même type de case), celle qui départage le mieux le haut du classement.
    selectBestQuestion(candidates) {
      if (!moteur || !Array.isArray(candidates) || candidates.length === 0) return null;
      const questions = [];
      let i = 0;
      while (i < candidates.length) {
        const c = candidates[i];
        const reponses = [];
        let k = 0;
        while (Array.isArray(c.reponses) && k < c.reponses.length) {
          reponses.push({ id: c.reponses[k].id, impact: c.reponses[k].effets || {} });
          k++;
        }
        questions.push({ id: c.id, reponses });
        i++;
      }
      const choix = moteur.getNextQuestion(questions, []);
      return choix ? choix.id : null;
    },

    getResults() {
      if (!moteur) return [];
      const classement = moteur.getRanking();
      const sortie = [];
      let i = 0;
      while (i < classement.length) {
        const r = classement[i];
        const courtes = raisonsCourtes(moteur, r.code, favoris.indexOf(r.code) !== -1);
        sortie.push({
          onet: r.code,
          titre: titres.get(r.code) || r.nom,
          rang: r.rang,
          categorie: cleCategorie(r.categorie, CATEGORIES),
          score: r.scoreInterne,
          raisons: courtes.raisons,                          // 2 raisons courtes (fiche, tableau)
          vigilance: courtes.vigilance,                      // un point à savoir
          explication: decouperExplication(r.explication)    // explication complète de C1
        });
        i++;
      }
      return sortie;
    },

    getExplanation() {
      return moteur ? { preferences: { ...moteur.preferences }, nbReponses: moteur.nbReponses } : null;
    }
  };
}
