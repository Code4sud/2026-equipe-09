// Configuration du moteur Agora Explorer (E2).
// Tout ce qui se règle sans toucher à la logique du jeu est dans ce fichier.

export const STATES = Object.freeze({
  IDLE: 'idle', // rien n'est chargé
  LOADING: 'loading', // chargement des JSON
  READY: 'ready', // profil trouvé, la partie peut démarrer
  PLAYING: 'playing', // le joueur peut lancer le dé
  ROLLING: 'rolling', // le dé roule
  MOVING: 'moving', // le pion avance
  QUESTION: 'question', // une carte est affichée (question ou information)
  PAUSED: 'paused',
  FINISHED: 'finished',
  ERROR: 'error',
});

// Les 12 attributs communs. Clés imposées par le format des JSON : ne pas les renommer.
export const ATTRIBUTES = Object.freeze([
  'exterieur',
  'travail_equipe',
  'contact_public',
  'activite_physique',
  'travail_manuel',
  'horaires_decales',
  'creativite',
  'analyse_chiffres',
  'aide_aux_autres',
  'technologie',
  'encadrement',
  'deplacements',
]);

// Libellés affichables des attributs (écrans de résultats, debug).
export const ATTRIBUTE_LABELS = Object.freeze({
  exterieur: 'Extérieur',
  travail_equipe: 'Travail en équipe',
  contact_public: 'Contact avec le public',
  activite_physique: 'Activité physique',
  travail_manuel: 'Travail manuel',
  horaires_decales: 'Horaires décalés',
  creativite: 'Créativité',
  analyse_chiffres: 'Analyse et chiffres',
  aide_aux_autres: 'Aide aux autres',
  technologie: 'Technologie',
  encadrement: 'Encadrement',
  deplacements: 'Déplacements',
});

const NO_CONTENT = 'Rien à signaler sur cette case. Relance le dé pour continuer.';

// Les 6 types de cases. C'est le SEUL endroit où un type est décrit : le moteur,
// l'interface PC et l'interface VR lisent tous cette table.
//   color / textColor : couleur de la case et couleur du texte posé dessus
//   symbol            : repère visuel en plus de la couleur (daltonisme, VR)
//   matchProfile      : true = on préfère les cartes qui visent un métier du profil
//   fallbackText      : carte de secours si cases.json n'a aucun contenu de ce type
export const CASE_TYPES = Object.freeze({
  preference: {
    label: 'Préférence',
    color: '#2F6FED',
    textColor: '#FFFFFF',
    symbol: '♥',
    matchProfile: true,
    fallbackText: NO_CONTENT,
  },
  situation: {
    label: 'Situation',
    color: '#D1431B',
    textColor: '#FFFFFF',
    symbol: '!',
    matchProfile: true,
    fallbackText: NO_CONTENT,
  },
  passerelle: {
    label: 'Passerelle',
    color: '#7A3FD6',
    textColor: '#FFFFFF',
    symbol: '⇄',
    matchProfile: true, // compatibilité jugée sur les champs « de » et « vers »
    fallbackText: NO_CONTENT,
  },
  decouverte: {
    label: 'Découverte',
    color: '#15805A',
    textColor: '#FFFFFF',
    symbol: '?',
    matchProfile: true,
    fallbackText: NO_CONTENT,
  },
  pause: {
    label: 'Pause',
    color: '#F2B705',
    textColor: '#1D2433',
    symbol: 'II',
    matchProfile: false,
    fallbackText: 'Pause. Respire un instant, puis relance le dé.',
  },
  surprise: {
    label: 'Surprise',
    color: '#CC2E82',
    textColor: '#FFFFFF',
    symbol: '★',
    matchProfile: false, // une surprise peut sortir du champ des possibles du profil
    fallbackText: NO_CONTENT,
  },
});

export const NEUTRAL_CASE = Object.freeze({
  label: 'Case neutre',
  color: '#8A94A6',
  textColor: '#FFFFFF',
  symbol: '·',
});

export const MAX_ANSWERS = 4;
export const MAX_TEXT_LENGTH = 120;

export const DEFAULT_CONFIG = Object.freeze({
  // Données
  dataPath: 'data/',
  files: Object.freeze({ profils: 'profils.json', cases: 'cases.json', metiers: 'metiers.json' }),
  acceptedStatuses: Object.freeze(['relu']), // seules ces cases sont jouables en démo

  // Rythme
  durationMs: 20 * 60 * 1000, // durée d'une partie
  diceFaces: 6,
  rollMs: 900, // durée de l'animation du dé
  stepMs: 350, // durée d'un pas du pion

  // Règles
  allowSkip: true, // le joueur peut passer une question
  maxTurns: null, // nombre maximum de lancers (null = illimité)
  endWhenContentExhausted: false, // true = fin de partie quand toutes les cartes ont été vues

  // Plateau : 15 à 18 cases, dans l'ordre de parcours. La case `start` est celle
  // du départ. loop = true : le pion tourne en boucle et la partie s'arrête au
  // timer. loop = false : ligne droite, la dernière case termine la partie.
  board: Object.freeze({
    loop: true,
    start: 0,
    cases: Object.freeze([
      'preference',
      'situation',
      'decouverte',
      'preference',
      'surprise',
      'situation',
      'passerelle',
      'preference',
      'pause',
      'situation',
      'decouverte',
      'preference',
      'surprise',
      'situation',
      'passerelle',
      'decouverte',
    ]),
  }),
});
