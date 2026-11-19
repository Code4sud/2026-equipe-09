// Chargement et validation des JSON (profils, cases, métiers).
// Principe : une donnée douteuse est écartée avec un avertissement lisible ;
// seule l'absence totale de profils ou de cases jouables bloque la partie.

import { ATTRIBUTES, CASE_TYPES, MAX_ANSWERS, MAX_TEXT_LENGTH } from './config.js';

// Erreur « métier » du moteur : un code stable + un message affichable au joueur.
export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

export const PROFILE_ID_PATTERN = /^\d{4}$/;

// "4821", " 4821 " et 4821 désignent le même profil ; 42 (nombre) devient "0042".
export function normalizeProfileId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value).padStart(4, '0');
  }
  return String(value ?? '').trim();
}

// Codes O*NET liés à un profil (champ des possibles + classement de l'entretien).
export function profileJobCodes(profile) {
  const codes = new Set();
  for (const item of profile?.champ_des_possibles ?? []) {
    const code = typeof item === 'string' ? item : item?.onet;
    if (typeof code === 'string' && code !== '') {
      codes.add(code);
    }
  }
  for (const code of profile?.classement_entretien ?? []) {
    if (typeof code === 'string' && code !== '') {
      codes.add(code);
    }
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

async function loadJson(url, fetchFn) {
  let response;
  let text;
  try {
    response = await fetchFn(url, { cache: 'no-cache' });
    text = response.ok ? await response.text() : '';
  } catch {
    throw new GameError(
      'JSON_MISSING',
      `Impossible de charger ${url}. Vérifie que le fichier existe et que le jeu est servi par un serveur web (pas ouvert en file://).`,
    );
  }
  if (!response.ok) {
    throw new GameError('JSON_MISSING', `Fichier introuvable : ${url} (HTTP ${response.status}).`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const hint = text.trimStart().startsWith('<')
      ? 'le serveur a renvoyé une page HTML, le fichier est probablement absent'
      : error.message;
    throw new GameError('JSON_INVALID', `Le fichier ${url} n'est pas un JSON valide (${hint}).`);
  }
}

function joinPath(folder, file) {
  if (!folder) {
    return file;
  }
  return folder.endsWith('/') ? folder + file : `${folder}/${file}`;
}

export async function loadGameData({ dataPath, files, fetchFn, acceptedStatuses }) {
  if (typeof fetchFn !== 'function') {
    throw new GameError('JSON_MISSING', "fetch() n'est pas disponible : impossible de charger les données.");
  }
  const [profils, cases, metiers] = await Promise.allSettled(
    [files.profils, files.cases, files.metiers].map((file) => loadJson(joinPath(dataPath, file), fetchFn)),
  );

  // profils.json et cases.json sont indispensables : on signale tous les
  // fichiers en cause d'un coup, pas seulement le premier.
  const failures = [profils, cases].filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (failures.length > 0) {
    throw new GameError(failures[0].code ?? 'JSON_MISSING', failures.map((failure) => failure.message).join(' '));
  }
  // metiers.json ne sert pas à jouer : s'il manque, on continue avec un avertissement.
  return validateGameData({
    profils: profils.value,
    cases: cases.value,
    metiers: metiers.status === 'fulfilled' ? metiers.value : { loadError: metiers.reason.message },
  }, { acceptedStatuses });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reportUnknownJobs(codes, label, warnings, knownJobs) {
  if (knownJobs.size === 0) {
    return; // metiers.json absent : rien à comparer
  }
  const unknown = codes.filter((code) => !knownJobs.has(code));
  if (unknown.length > 0) {
    warnings.push(`${label} : métier(s) absent(s) de metiers.json : ${unknown.join(', ')}.`);
  }
}

function validateMetiers(raw, warnings) {
  if (isPlainObject(raw) && typeof raw.loadError === 'string') {
    warnings.push(`metiers.json non chargé : ${raw.loadError} Les titres de métiers ne seront pas affichés.`);
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push('metiers.json doit contenir un tableau de métiers : il est ignoré.');
    return [];
  }
  const metiers = [];
  const seen = new Set();
  raw.forEach((metier, index) => {
    if (!isPlainObject(metier) || typeof metier.onet !== 'string' || metier.onet.trim() === '') {
      warnings.push(`metiers.json[${index}] ignoré : code O*NET manquant.`);
      return;
    }
    if (seen.has(metier.onet)) {
      warnings.push(`metiers.json : code O*NET ${metier.onet} en double (seul le premier est gardé).`);
      return;
    }
    seen.add(metier.onet);
    const missing = ATTRIBUTES.filter((key) => typeof metier.attributs?.[key] !== 'number');
    if (missing.length > 0) {
      warnings.push(`Métier ${metier.onet} : attributs manquants ou non numériques : ${missing.join(', ')}.`);
    }
    metiers.push(metier);
  });
  return metiers;
}

function validateProfils(raw, warnings, knownJobs) {
  if (!Array.isArray(raw)) {
    throw new GameError('DATA_INVALID', 'profils.json doit contenir un tableau de profils.');
  }
  const profils = [];
  const seen = new Set();
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry) || entry.id === undefined || entry.id === null) {
      warnings.push(`profils.json[${index}] ignoré : identifiant manquant.`);
      return;
    }
    const id = normalizeProfileId(entry.id);
    if (!PROFILE_ID_PATTERN.test(id)) {
      warnings.push(`Profil « ${id} » ignoré : l'identifiant doit comporter 4 chiffres.`);
      return;
    }
    if (seen.has(id)) {
      warnings.push(`Profil ${id} en double (seul le premier est gardé).`);
      return;
    }
    seen.add(id);
    if (entry.fictif !== true) {
      warnings.push(`Profil ${id} : « fictif » n'est pas à true. Seuls des profils fictifs doivent être utilisés.`);
    }
    const profile = {
      ...entry,
      id,
      champ_des_possibles: Array.isArray(entry.champ_des_possibles) ? entry.champ_des_possibles : [],
      classement_entretien: Array.isArray(entry.classement_entretien) ? entry.classement_entretien : [],
    };
    reportUnknownJobs([...profileJobCodes(profile)], `Profil ${id}`, warnings, knownJobs);
    profils.push(profile);
  });
  if (profils.length === 0) {
    throw new GameError('DATA_INVALID', 'Aucun profil exploitable dans profils.json.');
  }
  return profils;
}

// Ne garde que les 12 attributs connus, avec des valeurs numériques entre -1 et +1.
// (Une clé mal orthographiée ferait calculer NaN au module de ranking.)
function cleanEffects(raw, label, warnings) {
  const effects = {};
  if (raw === undefined || raw === null) {
    return effects;
  }
  if (!isPlainObject(raw)) {
    warnings.push(`${label} : « effets » invalide, ignoré.`);
    return effects;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!ATTRIBUTES.includes(key)) {
      warnings.push(`${label} : attribut inconnu « ${key} », effet ignoré.`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      warnings.push(`${label} : effet « ${key} » non numérique, ignoré.`);
    } else {
      const clamped = Math.max(-1, Math.min(1, value));
      if (clamped !== value) {
        warnings.push(`${label} : effet « ${key} » = ${value}, ramené à ${clamped} (bornes -1 à +1).`);
      }
      effects[key] = clamped;
    }
  }
  return effects;
}

function cleanAnswers(raw, label, warnings) {
  if (raw === undefined || raw === null) {
    return []; // pas de réponses = case informative
  }
  if (!Array.isArray(raw)) {
    warnings.push(`${label} : « reponses » n'est pas un tableau, la case devient informative.`);
    return [];
  }
  const answers = [];
  const seen = new Set();
  raw.forEach((answer, index) => {
    const id = isPlainObject(answer) && answer.id !== undefined && answer.id !== null ? String(answer.id).trim() : '';
    if (id === '' || typeof answer.texte !== 'string' || answer.texte.trim() === '') {
      warnings.push(`${label} : réponse n°${index + 1} ignorée (id ou texte manquant).`);
      return;
    }
    if (seen.has(id)) {
      warnings.push(`${label} : réponse « ${id} » en double, ignorée.`);
      return;
    }
    seen.add(id);
    answers.push({
      ...answer,
      id,
      effets: cleanEffects(answer.effets, `${label}, réponse ${id}`, warnings),
    });
  });
  if (answers.length > MAX_ANSWERS) {
    warnings.push(`${label} : ${answers.length} réponses, seules les ${MAX_ANSWERS} premières sont gardées.`);
    answers.length = MAX_ANSWERS;
  }
  if (raw.length > 0 && answers.length === 0) {
    warnings.push(`${label} : aucune réponse valide, la case devient informative.`);
  } else if (answers.length === 1) {
    warnings.push(`${label} : une seule réponse valide (2 à 4 attendues).`);
  }
  return answers;
}

function cleanJobList(raw, label, warnings, knownJobs) {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    warnings.push(`${label} : « metiers_cibles » n'est pas un tableau, ignoré.`);
    return [];
  }
  const codes = raw.filter((code) => typeof code === 'string' && code.trim() !== '');
  reportUnknownJobs(codes, label, warnings, knownJobs);
  return codes;
}

function validateCases(raw, warnings, { acceptedStatuses, knownJobs }) {
  if (!Array.isArray(raw)) {
    throw new GameError('DATA_INVALID', 'cases.json doit contenir un tableau de cases.');
  }
  const cases = [];
  const seen = new Set();
  let hiddenByStatus = 0;

  raw.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      warnings.push(`cases.json[${index}] ignorée : ce n'est pas un objet.`);
      return;
    }
    const id = entry.id === undefined || entry.id === null ? '' : String(entry.id).trim();
    if (id === '') {
      warnings.push(`cases.json[${index}] ignorée : identifiant manquant.`);
      return;
    }
    if (!acceptedStatuses.includes(entry.statut)) {
      hiddenByStatus += 1; // brouillon : écarté sans bruit
      return;
    }
    const label = `Case ${id}`;
    if (seen.has(id)) {
      warnings.push(`${label} : identifiant en double (seule la première est gardée).`);
      return;
    }
    seen.add(id);
    if (!CASE_TYPES[entry.type]) {
      warnings.push(`${label} ignorée : type inconnu « ${entry.type} ».`);
      return;
    }
    if (typeof entry.texte !== 'string' || entry.texte.trim() === '') {
      warnings.push(`${label} ignorée : texte manquant.`);
      return;
    }
    if (entry.texte.length > MAX_TEXT_LENGTH) {
      warnings.push(`${label} : texte de ${entry.texte.length} caractères (${MAX_TEXT_LENGTH} conseillés au maximum).`);
    }
    if (entry.type === 'passerelle') {
      const ends = [entry.de, entry.vers].filter((code) => typeof code === 'string' && code !== '');
      if (ends.length < 2) {
        warnings.push(`${label} : passerelle sans champs « de » et « vers » complets.`);
      }
      reportUnknownJobs(ends, label, warnings, knownJobs);
    }
    cases.push({
      ...entry,
      id,
      texte: entry.texte.trim(),
      metiers_cibles: cleanJobList(entry.metiers_cibles, label, warnings, knownJobs),
      reponses: cleanAnswers(entry.reponses, label, warnings),
    });
  });

  if (cases.length === 0) {
    throw new GameError(
      'DATA_INVALID',
      `Aucune case jouable dans cases.json (statut attendu : ${acceptedStatuses.join(', ')}).`,
    );
  }
  return { cases, hiddenByStatus };
}

// Valide des données déjà chargées. Sert aussi aux tests (données injectées).
export function validateGameData(raw, { acceptedStatuses = ['relu'] } = {}) {
  const warnings = [];
  const metiers = validateMetiers(raw?.metiers, warnings);
  const metiersByOnet = new Map(metiers.map((metier) => [metier.onet, metier]));
  const knownJobs = new Set(metiersByOnet.keys());
  const profils = validateProfils(raw?.profils, warnings, knownJobs);
  const { cases, hiddenByStatus } = validateCases(raw?.cases, warnings, { acceptedStatuses, knownJobs });

  return {
    profils,
    cases,
    metiers,
    metiersByOnet,
    warnings,
    stats: { profils: profils.length, cases: cases.length, hiddenByStatus, metiers: metiers.length },
  };
}
