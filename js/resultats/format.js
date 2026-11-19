// Formatage des données métiers : jamais de undefined ni de chiffre inventé.
// Module pur (aucune dépendance à A-Frame) : testable avec node.

export const ND = 'non disponible';

export const CATEGORIES = [
  { cle: 'tres_proche', libelle: 'Très proche de ton profil', couleur: '#2e8b57' },
  { cle: 'a_explorer', libelle: 'À explorer', couleur: '#d9822b' },
  { cle: 'plus_eloigne', libelle: "Plus éloigné pour l'instant", couleur: '#5c6b8a' }
];

export function categorie(cle) {
  let i = 0;
  while (i < CATEGORIES.length) {
    if (CATEGORIES[i].cle === cle) return CATEGORIES[i];
    i++;
  }
  return CATEGORIES[1];
}

// Vrai pour null, undefined, NaN, '', [] et la chaîne « non disponible ».
export function estVide(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return Number.isNaN(v);
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === '' || t === ND;
  }
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function texte(v) {
  return estVide(v) ? ND : String(v);
}

// Toujours un tableau de chaînes non vides (accepte aussi une chaîne seule).
export function liste(v) {
  if (!Array.isArray(v)) return estVide(v) || typeof v === 'object' ? [] : [String(v)];
  const sortie = [];
  let i = 0;
  while (i < v.length) {
    if (!estVide(v[i]) && typeof v[i] !== 'object') sortie.push(String(v[i]));
    i++;
  }
  return sortie;
}

function nombre(v) {
  if (estVide(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function euros(n) {
  return Math.round(n).toLocaleString('fr-FR') + ' €';
}

// { min, max } -> « 1 800 € – 2 100 € », ou ND si rien de fiable.
export function fourchette(f) {
  if (!f || typeof f !== 'object') return ND;
  const a = nombre(f.min);
  const b = nombre(f.max);
  if (a === null && b === null) return ND;
  if (a !== null && b !== null) return a === b ? euros(a) : euros(a) + ' – ' + euros(b);
  if (a !== null) return 'à partir de ' + euros(a);
  return "jusqu'à " + euros(b);
}

export function titreMetier(item, metier) {
  if (metier && !estVide(metier.titre)) return String(metier.titre);
  if (item && !estVide(item.titre)) return String(item.titre);
  return item && item.onet ? String(item.onet) : 'Métier';
}
