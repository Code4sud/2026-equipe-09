// Contenu court des fiches métiers, pour un public de 15 à 25 ans : peu de texte, l'essentiel.
// Module pur : un « bloc » = { type: 'para' | 'sous' | 'puce' | 'note', texte }.
//
// Les onglets dépendent des données : un onglet sans information utile n'est pas affiché
// (ex. « Évolution » si la carrière n'est pas renseignée). Quand les données seront complétées
// (par exemple par une IA locale), les onglets apparaîtront d'eux-mêmes.
// Rien n'est inventé : les textes sont raccourcis à partir de metiers.json et de ranking.js.

import { estVide, liste, fourchette, ND } from './format.js';

const NIVEAUX = { debut: 'Au début', confirme: 'Avec de l’expérience', senior: 'Plus tard' };
const SALAIRES = [['debut', 'Au début'], ['cinq_ans', 'Après 5 ans'], ['senior', 'Plus tard']];
// Repères de durée d'études par zone du Rapport des Possibles (définitions des zones du fichier de l'équipe).
const REPERE_ZONE = {
  1: 'Accessible vite : de quelques jours à quelques mois',
  2: 'Formation courte (type CAP ou bac pro)',
  3: 'Environ bac+2',
  4: 'Environ bac+3 à bac+5',
  5: 'Études longues (bac+5 et plus)'
};
const DIPLOMES = /\b(CAP|BEP|Bac\s?pro|Bac\s?\+\s?\d+|BTS|BUT|DUT|Licence|Master|Doctorat|Diplôme d['’]État(?: d['’][A-ZÉa-zé][\wéèêàç-]*)?)/gi;

function mots(texte) {
  return String(texte).trim().split(/\s+/);
}

// Retire les petits mots en fin de coupe (« adaptées aux… » -> « adaptées… »).
const PETITS_MOTS = /^(à|a|au|aux|de|des|du|d['’]\S*|la|le|les|l['’]\S*|en|et|ou|un|une|pour|par|avec|sur|dans|chez|son|sa|ses|leur|leurs)$/i;
function couperProprement(listeMots) {
  const m = listeMots.slice();
  while (m.length > 3 && (PETITS_MOTS.test(m[m.length - 1]) || /[,;:]$/.test(m[m.length - 1]))) m.pop();
  return m.join(' ').replace(/[,;:]$/, '') + '…';
}

// Une phrase courte : la première phrase, coupée à une virgule si elle dépasse maxMots.
export function phraseCourte(texte, maxMots = 16) {
  if (estVide(texte)) return '';
  // Sans les précisions entre parenthèses : « un véhicule léger (camionnette, fourgon) » -> « un véhicule léger ».
  let phrase = String(texte).trim().split(/(?<=[.!?])\s/)[0].replace(/\s*\([^)]*\)/g, '').replace(/[.;:,]+$/, '');
  if (mots(phrase).length <= maxMots) return phrase + '.';
  const m = mots(phrase).slice(0, maxMots);
  let coupe = m.length;
  let i = m.length - 1;
  while (i >= 6) {
    if (/[,;]$/.test(m[i])) {
      coupe = i + 1;
      break;
    }
    i--;
  }
  if (coupe < mots(phrase).length && !/[,;]$/.test(m[coupe - 1])) return couperProprement(m.slice(0, coupe));
  return m.slice(0, coupe).join(' ').replace(/[,;]$/, '') + (coupe < mots(phrase).length ? '…' : '.');
}

// Une mission en quelques mots : on s'arrête avant les précisions (« selon… », « afin de… »).
export function missionCourte(texte, maxMots = 9) {
  let t = String(texte).trim().replace(/[.;]$/, '');
  const coupe = t.search(/,| selon | afin | en respectant | dans le respect | conformément | tout en /);
  if (coupe > 0 && mots(t.slice(0, coupe)).length >= 3) t = t.slice(0, coupe);
  const m = mots(t);
  return m.length > maxMots ? couperProprement(m.slice(0, maxMots)) : t;
}

// Une mission doit commencer par une action (« Prépare… »), pas par une précision (« En adoptant… »).
const DEBUT_PRECISION = /^(En|Pour|Afin|Dans|Selon|Avec|Lors|Tout|Grâce)\b/;

function puces(valeurs, max, maxMots, blocs) {
  const l = liste(valeurs).filter((v) => !DEBUT_PRECISION.test(v.trim()));
  let i = 0;
  while (i < l.length && i < max) {
    blocs.push({ type: 'puce', texte: missionCourte(l[i], maxMots) });
    i++;
  }
  return Math.min(l.length, max);
}

function diplomesRepere(textes) {
  const vus = [];
  let i = 0;
  while (i < textes.length) {
    const trouves = String(textes[i]).match(DIPLOMES) || [];
    let k = 0;
    while (k < trouves.length) {
      let d = trouves[k].replace(/\s+/g, ' ').replace(/Bac ?\+ ?/i, 'Bac+').replace(/^bac pro$/i, 'Bac pro');
      d = d.charAt(0).toUpperCase() + d.slice(1);
      if (vus.map((v) => v.toLowerCase()).indexOf(d.toLowerCase()) === -1) vus.push(d);
      k++;
    }
    i++;
  }
  return vus.slice(0, 4);
}

function sourcesCourtes(m, f, s) {
  const toutes = liste(m.sources).concat(liste(f.source), liste(s.source));
  const courtes = [];
  let i = 0;
  while (i < toutes.length) {
    const c = toutes[i].split(' – ')[0].trim();
    if (c && courtes.indexOf(c) === -1) courtes.push(c);
    i++;
  }
  return courtes.join(' · ');
}

export function construireFiche(item, metier) {
  const m = metier && typeof metier === 'object' ? metier : {};
  const f = m.formation && typeof m.formation === 'object' ? m.formation : {};
  const s = m.salaires && typeof m.salaires === 'object' ? m.salaires : {};
  const onglets = [];

  // Métier : une phrase + 3 missions courtes.
  const metierBlocs = [];
  if (!metier) metierBlocs.push({ type: 'note', texte: 'Fiche à venir : les informations arrivent bientôt.' });
  else {
    if (!estVide(m.description)) metierBlocs.push({ type: 'para', texte: phraseCourte(m.description) });
    if (liste(m.missions).length > 0) {
      metierBlocs.push({ type: 'sous', texte: 'Au quotidien' });
      puces(m.missions, 3, 8, metierBlocs);
    }
  }
  onglets.push({ cle: 'metier', court: 'Métier', titre: 'Le métier en bref', blocs: metierBlocs });

  // Compétences : 4 maximum.
  const comp = [];
  if (puces(m.competences, 4, 7, comp) > 0) {
    onglets.push({ cle: 'competences', court: 'Compétences', titre: 'Ce qui t’aidera', blocs: comp });
  }

  // Formation : diplômes repérés dans le texte officiel + repère de durée.
  const form = [];
  const diplomes = diplomesRepere(liste(f.diplomes));
  if (diplomes.length > 0) {
    form.push({ type: 'sous', texte: 'Diplômes possibles' });
    let i = 0;
    while (i < diplomes.length) {
      form.push({ type: 'puce', texte: diplomes[i] });
      i++;
    }
  }
  const duree = !estVide(f.duree) ? String(f.duree) : REPERE_ZONE[m.zone];
  if (duree) {
    form.push({ type: 'sous', texte: 'Combien de temps ?' });
    form.push({ type: 'para', texte: duree });
  }
  if (form.length > 0) onglets.push({ cle: 'formation', court: 'Formation', titre: 'Pour y arriver', blocs: form });

  // Évolution : seulement si la carrière est renseignée.
  const evo = [];
  const carriere = Array.isArray(m.carriere) ? m.carriere : [];
  let i = 0;
  while (i < carriere.length) {
    const etape = carriere[i] && typeof carriere[i] === 'object' ? carriere[i] : {};
    const postes = liste(etape.postes);
    if (postes.length > 0) evo.push({ type: 'puce', texte: (NIVEAUX[etape.niveau] || etape.niveau) + ' : ' + postes.slice(0, 2).join(', ') });
    i++;
  }
  if (evo.length > 0) onglets.push({ cle: 'evolution', court: 'Évolution', titre: 'Tu peux évoluer', blocs: evo });

  // Salaires : une ligne par niveau, ou un message court.
  const sal = [];
  i = 0;
  while (i < SALAIRES.length) {
    const v = fourchette(s[SALAIRES[i][0]]);
    if (v !== ND) sal.push({ type: 'puce', texte: SALAIRES[i][1] + ' : ' + v });
    i++;
  }
  if (sal.length > 0) sal.push({ type: 'note', texte: [s.unite, s.zone_geo].filter((x) => !estVide(x)).join(', ') });
  else sal.push({ type: 'para', texte: 'Pas encore de chiffre fiable pour ce métier.' });
  onglets.push({ cle: 'salaires', court: 'Salaires', titre: 'Combien on gagne', blocs: sal });

  // Pourquoi ? : 2 raisons courtes + un point à savoir (ranking.js).
  const pq = [];
  const raisons = liste(item && item.raisons);
  i = 0;
  while (i < raisons.length && i < 2) {
    pq.push({ type: 'puce', texte: raisons[i] });
    i++;
  }
  if (!estVide(item && item.vigilance)) {
    pq.push({ type: 'sous', texte: 'À savoir' });
    pq.push({ type: 'para', texte: String(item.vigilance) });
  }
  if (pq.length === 0) pq.push({ type: 'para', texte: 'Ce métier fait partie de ton champ des possibles.' });
  pq.push({ type: 'note', texte: 'Une piste à explorer, pas une décision.' });
  onglets.push({ cle: 'pourquoi', court: 'Pourquoi ?', titre: 'Pourquoi pour toi', blocs: pq });

  return { onglets, sources: sourcesCourtes(m, f, s) };
}
