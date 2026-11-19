// Construit le contenu des 7 rubriques d'une fiche métier.
// Module pur : un « bloc » = { type: 'para' | 'sous' | 'puce' | 'nd' | 'note', texte }.

import { ND, estVide, texte, liste, fourchette } from './format.js';

export const ONGLETS = [
  { cle: 'presentation', court: 'Métier', titre: 'Présentation et missions' },
  { cle: 'competences', court: 'Compétences', titre: 'Compétences et qualités utiles' },
  { cle: 'formation', court: 'Formation', titre: 'Formation et durée des études' },
  { cle: 'evolution', court: 'Évolution', titre: 'Évolution professionnelle' },
  { cle: 'salaires', court: 'Salaires', titre: 'Salaires (estimations)' },
  { cle: 'pourquoi', court: 'Pourquoi ?', titre: 'Pourquoi ce métier ressort pour toi' },
  { cle: 'sources', court: 'Sources', titre: 'Sources des informations' }
];

const NIVEAUX = {
  debut: 'Au début',
  confirme: 'Après quelques années',
  senior: 'Niveau senior'
};

const SALAIRES = [
  ['debut', 'Débutant'],
  ['cinq_ans', 'Après environ 5 ans'],
  ['senior', 'Niveau senior']
];

function nd(precision) {
  return { type: 'nd', texte: precision ? precision + ' : ' + ND : ND };
}

function puces(valeurs, blocs) {
  const l = liste(valeurs);
  if (l.length === 0) {
    blocs.push(nd());
    return;
  }
  let i = 0;
  while (i < l.length) {
    blocs.push({ type: 'puce', texte: l[i] });
    i++;
  }
}

export function construireRubriques(item, metier) {
  const m = metier && typeof metier === 'object' ? metier : {};
  const r = {};

  // 1. Présentation
  r.presentation = [];
  if (!metier) {
    r.presentation.push({ type: 'nd', texte: 'Fiche à venir : les informations sur ce métier ne sont pas encore prêtes.' });
  } else {
    r.presentation.push(estVide(m.description) ? nd('Description') : { type: 'para', texte: String(m.description) });
    r.presentation.push({ type: 'sous', texte: 'Missions principales' });
    puces(m.missions, r.presentation);
  }

  // 2. Compétences
  r.competences = [];
  puces(m.competences, r.competences);

  // 3. Formation
  const f = m.formation && typeof m.formation === 'object' ? m.formation : {};
  r.formation = [{ type: 'sous', texte: 'Diplômes possibles' }];
  puces(f.diplomes, r.formation);
  r.formation.push({ type: 'sous', texte: 'Durée des études' });
  r.formation.push(estVide(f.duree) ? nd() : { type: 'para', texte: String(f.duree) });

  // 4. Évolution
  r.evolution = [];
  const carriere = Array.isArray(m.carriere) ? m.carriere : [];
  if (carriere.length === 0) r.evolution.push(nd());
  let i = 0;
  while (i < carriere.length) {
    const etape = carriere[i] && typeof carriere[i] === 'object' ? carriere[i] : {};
    r.evolution.push({ type: 'sous', texte: NIVEAUX[etape.niveau] || texte(etape.niveau) });
    const postes = liste(etape.postes);
    r.evolution.push(postes.length > 0 ? { type: 'para', texte: postes.join(', ') } : nd());
    i++;
  }

  // 5. Salaires
  const s = m.salaires && typeof m.salaires === 'object' ? m.salaires : {};
  r.salaires = [{ type: 'note', texte: 'Montants : ' + texte(s.unite) + ' · Zone : ' + texte(s.zone_geo) }];
  let disponibles = 0;
  i = 0;
  while (i < SALAIRES.length) {
    const valeur = fourchette(s[SALAIRES[i][0]]);
    if (valeur !== ND) disponibles++;
    r.salaires.push({ type: valeur === ND ? 'nd' : 'para', texte: SALAIRES[i][1] + ' : ' + valeur });
    i++;
  }
  if (!estVide(s.remarque)) r.salaires.push({ type: 'note', texte: String(s.remarque) });
  if (disponibles === 0) r.salaires.push({ type: 'note', texte: 'Pas encore de chiffre fiable : on préfère ne rien inventer.' });
  else r.salaires.push({ type: 'note', texte: 'Source : ' + texte(s.source) });

  // 6. Pourquoi ce métier (vient de ranking.js)
  r.pourquoi = [];
  const raisons = liste(item && item.raisons);
  if (raisons.length === 0) r.pourquoi.push(nd('Explication'));
  i = 0;
  while (i < raisons.length) {
    r.pourquoi.push({ type: 'puce', texte: raisons[i] });
    i++;
  }
  r.pourquoi.push({ type: 'note', texte: "C'est une piste à explorer, pas une décision : tous les métiers restent ouverts." });

  // 7. Sources (sans doublon)
  const toutes = liste(m.sources).concat(liste(f.source), liste(s.source));
  const uniques = [];
  i = 0;
  while (i < toutes.length) {
    if (uniques.indexOf(toutes[i]) === -1) uniques.push(toutes[i]);
    i++;
  }
  r.sources = [];
  puces(uniques, r.sources);

  return r;
}
