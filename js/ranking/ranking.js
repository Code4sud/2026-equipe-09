/**
 * ranking.js : moteur de classement « Agora Explorer »
 * ----------------------------------------------------------------------------
 * JavaScript pur (ES6+), aucune dépendance, aucune référence à A-Frame/VR.
 * Fonctionne dans Node.js (CommonJS) et dans la console d'un navigateur.
 *
 * PRINCIPE DU MODÈLE
 * ------------------
 *  score(métier) = prior(métier) * priorWeight
 *                + learningRate * Σ_attr  préférence[attr] * centré(métier, attr)
 *
 *  - prior : dérivé du classement initial du psychologue, normalisé dans [0, 1]
 *            (1er = 1, dernier = 0).
 *  - préférence[attr] : somme cumulée (bornée dans [-prefClamp, +prefClamp]) des
 *            impacts des réponses du joueur. Positif = « j'aime », négatif = « j'évite ».
 *  - centré(métier, attr) = (valeur - 0.5) * 2, dans [-1, 1]. Un attribut à 0.5 est
 *            neutre : il ne favorise ni ne pénalise le métier.
 *
 *  RÈGLE « AUCUNE PORTE FERMÉE » : aucun métier n'est jamais retiré ni filtré.
 *  Seuls le score, le rang et la catégorie évoluent.
 *
 * FORMATS ATTENDUS
 * ----------------
 *  Métier   : { code: "A1203", nom: "Paysagiste", attributs: { exterieur: 1, ... } }
 *  Question : { id: "q1", texte: "...", reponses: [ { id: "a", texte: "...", impact: { exterieur: 0.6 } } ] }
 *  Impact   : { attribut: delta } avec delta typiquement dans [-1, 1]
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node.js (CommonJS)
  } else {
    root.RankingModule = api;        // Navigateur / console
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Constantes
  // --------------------------------------------------------------------------

  /** Les 3 catégories de fin (aucun pourcentage brut exposé au joueur). */
  const CATEGORIES = Object.freeze({
    PROCHE: 'Très proche de toi',
    EXPLORER: 'À explorer',
    ELOIGNE: 'Plus éloigné pour l\'instant',
  });

  /**
   * Libellés français des attributs.
   *  - def : forme avec article défini  ("met en avant le travail manuel")
   *  - de  : forme introduite par « de » ("comporte peu d'horaires décalés")
   * Personnalisable via new RankingEngine({ labels: {...} }).
   */
  const DEFAULT_LABELS = Object.freeze({
    travail_manuel:  { def: 'le travail manuel',          de: 'de travail manuel' },
    horaires_decales:{ def: 'les horaires décalés',       de: 'd\'horaires décalés' },
    exterieur:       { def: 'le travail en extérieur',    de: 'de travail en extérieur' },
    contact_public:  { def: 'le contact avec le public',  de: 'de contact avec le public' },
    travail_equipe:  { def: 'le travail en équipe',       de: 'de travail en équipe' },
    autonomie:       { def: 'l\'autonomie',               de: 'd\'autonomie' },
    creativite:      { def: 'la créativité',              de: 'de créativité' },
    analyse_logique: { def: 'l\'analyse et la logique',   de: 'd\'analyse et de logique' },
  });

  const DEFAULT_OPTIONS = Object.freeze({
    topK: 5,                // nombre de métiers « en tête » utilisés pour choisir la question
    priorWeight: 1,         // poids du classement initial du psychologue
    learningRate: 1,        // poids de l'apprentissage via les réponses
    prefClamp: 1,           // borne de chaque préférence : [-prefClamp, +prefClamp]
    seuilProche: 1 / 3,     // écart relatif au 1er (0 = au niveau du 1er, 1 = au niveau du dernier)
    seuilExplorer: 2 / 3,   //   ≤ seuilProche → proche ; ≤ seuilExplorer → à explorer ; sinon éloigné
    seuilExplication: 0.1,  // contribution minimale d'un attribut pour être cité dans l'explication
    maxArgumentsPositifs: 3,
    maxArgumentsVigilance: 2,
  });

  // --------------------------------------------------------------------------
  // Utilitaires purs
  // --------------------------------------------------------------------------

  const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  /** Variance de population d'un tableau de nombres. */
  function variance(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  }

  /** Jointure française : "a", "a et b", "a, b et c". */
  function joinFr(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' et ' + items[items.length - 1];
  }

  // --------------------------------------------------------------------------
  // Moteur
  // --------------------------------------------------------------------------

  class RankingEngine {
    /**
     * @param {Object} [options] voir DEFAULT_OPTIONS ; `labels` permet d'ajouter/surcharger des libellés.
     */
    constructor(options = {}) {
      const { labels, ...rest } = options;
      this.options = { ...DEFAULT_OPTIONS, ...rest };
      this.labels = { ...DEFAULT_LABELS, ...(labels || {}) };
      this._reset();
    }

    _reset() {
      /** @type {Array} métiers internes (copies, jamais supprimés) */
      this.metiers = [];
      /** @type {Object<string, number>} préférences cumulées du joueur */
      this.preferences = {};
      this.nbReponses = 0;
      this.avertissements = [];
    }

    // ------------------------------------------------------------------------
    // 1) Initialisation
    // ------------------------------------------------------------------------

    /**
     * Initialise (ou réinitialise) le moteur.
     * @param {Array} metiersList          liste complète des métiers
     * @param {string[]} classementPsyInitial codes ROME ordonnés par le psychologue
     * @returns {RankingEngine} this (chaînable)
     */
    init(metiersList, classementPsyInitial = []) {
      if (!Array.isArray(metiersList) || metiersList.length === 0) {
        throw new Error('init : metiersList doit être un tableau non vide.');
      }
      this._reset();

      const parCode = new Map();
      for (const m of metiersList) {
        if (!m || typeof m.code !== 'string') throw new Error('init : chaque métier doit avoir un `code` (string).');
        if (parCode.has(m.code)) throw new Error(`init : code métier en double : ${m.code}`);
        parCode.set(m.code, m);
      }

      // Ordre initial : d'abord les codes du psy (dédoublonnés, existants),
      // puis les métiers non cités, dans leur ordre d'origine → aucun métier perdu.
      const ordre = [];
      const vus = new Set();
      for (const code of classementPsyInitial || []) {
        if (!parCode.has(code)) {
          this.avertissements.push(`Code inconnu ignoré dans le classement du psychologue : ${code}`);
        } else if (!vus.has(code)) {
          vus.add(code);
          ordre.push(code);
        }
      }
      for (const m of metiersList) if (!vus.has(m.code)) ordre.push(m.code);

      const n = ordre.length;
      this.metiers = ordre.map((code, i) => {
        const src = parCode.get(code);
        return {
          code,
          nom: src.nom || code,
          attributs: this._normaliserAttributs(src.attributs),
          rangInitial: i + 1,
          prior: n > 1 ? 1 - i / (n - 1) : 1,   // 1er → 1, dernier → 0
        };
      });
      return this;
    }

    /** Copie défensive : ne garde que les valeurs numériques, bornées dans [0, 1]. */
    _normaliserAttributs(attributs) {
      const out = {};
      for (const [k, v] of Object.entries(attributs || {})) {
        if (isNum(v)) out[k] = clamp(v, 0, 1);
      }
      return out;
    }

    // ------------------------------------------------------------------------
    // Calculs internes
    // ------------------------------------------------------------------------

    /** Valeur centrée de l'attribut du métier, dans [-1, 1] (0.5 → 0 ; absent → neutre). */
    _centre(metier, attr) {
      const v = metier.attributs[attr];
      return ((v === undefined ? 0.5 : v) - 0.5) * 2;
    }

    /** Contribution d'un attribut au score d'un métier, avec les préférences actuelles. */
    _contribution(metier, attr) {
      return this.options.learningRate * (this.preferences[attr] || 0) * this._centre(metier, attr);
    }

    /** Score interne (usage moteur ; non destiné à être affiché en pourcentage). */
    _score(metier) {
      let s = metier.prior * this.options.priorWeight;
      for (const attr of Object.keys(this.preferences)) s += this._contribution(metier, attr);
      return s;
    }

    /** Métiers triés par score décroissant ; égalité → ordre initial du psychologue. */
    _tries() {
      return this.metiers
        .map((m) => ({ m, score: this._score(m) }))
        .sort((a, b) => b.score - a.score || a.m.rangInitial - b.m.rangInitial);
    }

    /** Variation de score qu'entraînerait un impact sur un métier (simulation exacte, clamp inclus). */
    _deltaSimule(metier, impact) {
      const c = this.options.prefClamp;
      let delta = 0;
      for (const [attr, v] of Object.entries(impact)) {
        if (!isNum(v)) continue;
        const avant = this.preferences[attr] || 0;
        const apres = clamp(avant + v, -c, c);
        delta += this.options.learningRate * (apres - avant) * this._centre(metier, attr);
      }
      return delta;
    }

    // ------------------------------------------------------------------------
    // 2) Choix de la prochaine question
    // ------------------------------------------------------------------------

    /**
     * Pouvoir discriminant d'une question : pour chaque réponse possible, on simule la
     * variation de score des métiers du Top K, puis on mesure la variance de ces
     * variations (plus elle est grande, plus la réponse sépare les métiers en tête).
     * On moyenne ensuite sur toutes les réponses de la question.
     * @returns {number} ≥ 0
     */
    evaluerQuestion(question) {
      const top = this._tries().slice(0, this.options.topK).map((x) => x.m);
      if (top.length < 2) return 0;
      const reponses = Array.isArray(question && question.reponses) ? question.reponses : [];
      let total = 0;
      let nb = 0;
      for (const r of reponses) {
        if (!r || typeof r.impact !== 'object' || r.impact === null) continue;
        total += variance(top.map((m) => this._deltaSimule(m, r.impact)));
        nb++;
      }
      return nb ? total / nb : 0;
    }

    /**
     * Sélectionne, parmi les questions non encore posées, celle qui départage le mieux le Top K.
     * @param {Array} questionsDisponibles
     * @param {Array<string|number|{id}>} questionsDejaPosees ids (ou objets avec `id`)
     * @returns {Object|null} la question choisie, ou null s'il n'en reste plus
     */
    getNextQuestion(questionsDisponibles, questionsDejaPosees = []) {
      const posees = new Set(
        (questionsDejaPosees || []).map((q) => (q !== null && typeof q === 'object' ? q.id : q))
      );
      const candidates = (questionsDisponibles || []).filter((q) => q && !posees.has(q.id));
      if (candidates.length === 0) return null;

      let meilleure = candidates[0];
      let meilleurScore = -Infinity;
      for (const q of candidates) {
        const s = this.evaluerQuestion(q);
        if (s > meilleurScore) {   // strict : à égalité, la première question de la liste gagne
          meilleurScore = s;
          meilleure = q;
        }
      }
      return meilleure;
    }

    // ------------------------------------------------------------------------
    // 3) Application d'une réponse
    // ------------------------------------------------------------------------

    /**
     * Intègre le vecteur d'impact d'une réponse dans les préférences du joueur.
     * Aucun métier n'est retiré : seuls les scores (donc l'ordre) évoluent.
     * @param {Object<string, number>} impactReponse ex. { horaires_decales: -0.5, travail_equipe: 0.4 }
     * @returns {RankingEngine} this
     */
    applyAnswer(impactReponse) {
      if (!impactReponse || typeof impactReponse !== 'object') {
        throw new Error('applyAnswer : impactReponse doit être un objet { attribut: delta }.');
      }
      const c = this.options.prefClamp;
      for (const [attr, v] of Object.entries(impactReponse)) {
        if (!isNum(v)) continue;
        this.preferences[attr] = clamp((this.preferences[attr] || 0) + v, -c, c);
      }
      this.nbReponses++;
      return this;
    }

    // ------------------------------------------------------------------------
    // 4) Classement final : catégories + explications
    // ------------------------------------------------------------------------

    /**
     * @returns {Array<{code, nom, rang, rangInitial, evolution, categorie, explication, scoreInterne}>}
     *   Tous les métiers, triés. `evolution` > 0 : le métier a gagné des places.
     *   `scoreInterne` est fourni pour le debug uniquement.
     */
    getRanking() {
      const tries = this._tries();
      if (tries.length === 0) return [];

      const max = tries[0].score;
      const min = tries[tries.length - 1].score;
      const etendue = max - min;

      return tries.map(({ m, score }, i) => {
        const categorie = this._categorie(score, max, etendue);
        return {
          code: m.code,
          nom: m.nom,
          rang: i + 1,
          rangInitial: m.rangInitial,
          evolution: m.rangInitial - (i + 1),
          categorie,
          explication: this._expliquer(m, categorie),
          scoreInterne: Math.round(score * 1000) / 1000,
        };
      });
    }

    /**
     * Seuils dynamiques : on mesure l'écart au premier rapporté à l'étendue actuelle
     * des scores (0 = au niveau du 1er, 1 = au niveau du dernier).
     */
    _categorie(score, max, etendue) {
      if (etendue < 1e-9) return CATEGORIES.PROCHE;   // tous ex æquo
      const ecartRelatif = (max - score) / etendue;
      if (ecartRelatif <= this.options.seuilProche) return CATEGORIES.PROCHE;
      if (ecartRelatif <= this.options.seuilExplorer) return CATEGORIES.EXPLORER;
      return CATEGORIES.ELOIGNE;
    }

    _label(attr) {
      const l = this.labels[attr];
      if (l) return l;
      const nom = `« ${attr.replace(/_/g, ' ')} »`;   // repli pour un attribut sans libellé
      return { def: nom, de: `de ${nom}` };
    }

    /**
     * Phrase en français croisant les attributs du métier avec les préférences
     * exprimées pendant la partie.
     *  - Arguments positifs : attribut fort que le joueur recherche, ou attribut faible qu'il évite.
     *  - Points de vigilance : l'inverse.
     */
    _expliquer(metier, categorie) {
      const { seuilExplication, maxArgumentsPositifs, maxArgumentsVigilance } = this.options;

      const analyses = Object.keys(this.preferences)
        .map((attr) => ({
          attr,
          contrib: this._contribution(metier, attr),
          pref: this.preferences[attr],
          fort: this._centre(metier, attr) > 0,   // attribut au-dessus du neutre (0.5)
        }))
        .filter((a) => Math.abs(a.contrib) >= seuilExplication);

      const positifs = analyses
        .filter((a) => a.contrib > 0)
        .sort((a, b) => b.contrib - a.contrib)
        .slice(0, maxArgumentsPositifs);
      const vigilances = analyses
        .filter((a) => a.contrib < 0)
        .sort((a, b) => a.contrib - b.contrib)
        .slice(0, maxArgumentsVigilance);

      // Aucune préférence exploitable : on s'appuie sur le point de départ.
      if (positifs.length === 0 && vigilances.length === 0) {
        return 'Ce métier fait partie de la sélection initiale de ton psychologue ; réponds à quelques questions pour affiner.';
      }

      const parts = [];

      if (positifs.length) {
        const aimes = positifs.filter((a) => a.pref > 0 && a.fort).map((a) => this._label(a.attr).def);
        const evites = positifs.filter((a) => a.pref < 0 && !a.fort).map((a) => this._label(a.attr).de);
        const segments = [];
        if (aimes.length) {
          segments.push(`il met en avant ${joinFr(aimes)}, des points qui comptent pour toi`);
        }
        if (evites.length) {
          segments.push(`il comporte ${aimes.length ? 'aussi ' : ''}peu ${joinFr(evites)}, ce que tu préfères éviter`);
        }
        const intro = {
          [CATEGORIES.PROCHE]: 'Bien classé car ',
          [CATEGORIES.EXPLORER]: 'À explorer car ',
          [CATEGORIES.ELOIGNE]: 'Il garde tout de même des atouts : ',
        }[categorie];
        parts.push(intro + segments.join(' ; ') + '.');
      }

      if (vigilances.length) {
        const clauses = vigilances.map((a) => {
          const l = this._label(a.attr);
          return a.pref < 0
            ? `il comporte beaucoup ${l.de}, alors que tu préfères éviter cela`
            : `il comporte peu ${l.de}, alors que cela compte pour toi`;
        });
        parts.push((positifs.length ? 'Point de vigilance : ' : 'Plus éloigné car ') + clauses.join(' ; ') + '.');
      }

      if (categorie === CATEGORIES.ELOIGNE) {
        parts.push('Il reste explorable : aucune porte n\'est fermée.');
      }
      return parts.join(' ');
    }
  }

  return { RankingEngine, CATEGORIES, DEFAULT_OPTIONS };
});
