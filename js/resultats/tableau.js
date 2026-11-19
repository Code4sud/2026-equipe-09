// Tableau de résultats : 3 colonnes (une par catégorie) en arc autour du joueur assis.
// De gauche à droite : « À explorer », « Très proche de ton profil » (les plus compatibles,
// au centre), « Plus éloigné pour l'instant ».
// Chaque colonne affiche la liste complète de ses métiers : les cartes se resserrent quand
// la liste s'allonge, puis passent sur deux sous-colonnes au-delà de 10 métiers.

import { categorie, titreMetier, liste } from './format.js';
import { creerPanneau, arrondi, couper, ellipse, ajuster, police } from './canvas-panneau.js';

const RAYON = 2.5;
const COLONNES = [
  { cle: 'a_explorer', angle: -40 },
  { cle: 'tres_proche', angle: 0 },
  { cle: 'plus_eloigne', angle: 40 }
];
const LARGEUR = 1.0;
const HAUT = 0.58;          // haut de la zone des cartes (par rapport aux yeux)
const HAUTEUR_ZONE = 1.5;   // hauteur disponible pour la liste
const ECART = 0.02;

function grouper(classement) {
  const groupes = { tres_proche: [], a_explorer: [], plus_eloigne: [] };
  let i = 0;
  while (i < classement.length) {
    const item = classement[i];
    if (item && groupes[item.categorie]) groupes[item.categorie].push(item);
    else if (item && item.onet) {
      console.warn('[resultats] catégorie inconnue, rangée dans « À explorer » :', item);
      groupes.a_explorer.push(item);
    }
    i++;
  }
  return groupes;
}

// Disposition d'une colonne de n cartes : nombre de sous-colonnes, taille et position de chaque carte.
function disposition(n) {
  const sousColonnes = n > 10 ? 2 : 1;
  const rangees = Math.max(1, Math.ceil(n / sousColonnes));
  const h = Math.min(0.28, HAUTEUR_ZONE / rangees - ECART);
  const l = sousColonnes === 1 ? LARGEUR : (LARGEUR - ECART) / 2;
  return { sousColonnes, h, l, pas: h + ECART };
}

export function creerTableau({ classement, metiers, vus, onChoisir, garde }) {
  const el = document.createElement('a-entity');
  const groupes = grouper(Array.isArray(classement) ? classement : []);

  const titre = creerPanneau({
    largeur: 2.0,
    hauteur: 0.3,
    dessiner: function (ctx, w) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = police(62, true);
      ctx.fillText('Tes pistes de métiers', w / 2, 8);
      ctx.fillStyle = '#c9d2e8';
      ctx.font = police(36, false);
      ctx.fillText('Fixe un métier pour ouvrir sa fiche', w / 2, 92);
    }
  });
  titre.setAttribute('position', '0 1.12 ' + (-RAYON));
  el.appendChild(titre);

  let c = 0;
  while (c < COLONNES.length) {
    el.appendChild(creerColonne(categorie(COLONNES[c].cle), groupes[COLONNES[c].cle], COLONNES[c].angle));
    c++;
  }
  return { el };

  function creerCarte(cat, item, l, h) {
    const metier = metiers.get(item.onet);
    const compacte = h < 0.2;
    const carte = creerPanneau({
      largeur: l,
      hauteur: h,
      cliquable: true,
      onClic: function (e) {
        if (!garde(this, e)) return;
        vus.add(item.onet);
        carte.redessiner();
        onChoisir(item);
      },
      dessiner: function (ctx, w, hp, elCarte) {
        ctx.save();
        arrondi(ctx, 0, 0, w, hp, Math.min(26, hp / 3));
        ctx.fillStyle = elCarte && elCarte.survol ? '#EDE8FF' : '#ffffff';
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = cat.couleur;
        ctx.fillRect(0, 0, 20, hp);
        ctx.restore();

        const x = 38;
        const largeurTexte = w - x - 20;
        const vu = vus.has(item.onet);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#1b2133';
        const titreTexte = (vu ? '✓ ' : '') + titreMetier(item, metier);
        if (compacte) {
          // Carte resserrée : le titre seul, sur une ligne, à la taille qui tient.
          ajuster(ctx, titreTexte, largeurTexte, Math.round(hp * 0.5), true, 18);
          ctx.fillText(ellipse(ctx, titreTexte, largeurTexte), x, hp / 2);
          return;
        }
        ctx.textBaseline = 'top';
        ctx.font = police(46, true);
        const lignes = couper(ctx, titreTexte, largeurTexte);
        ctx.fillText(lignes[0] || '', x, 18);
        if (lignes.length > 1) ctx.fillText(ellipse(ctx, lignes.slice(1).join(' '), largeurTexte), x, 72);
        const raisons = liste(item.raisons);
        const sousTitre = !metier ? 'Fiche à venir' : (raisons[0] || 'Ouvre la fiche pour en savoir plus');
        ctx.fillStyle = '#5b6478';
        ctx.font = police(30, false, !metier);
        ctx.fillText(ellipse(ctx, sousTitre, largeurTexte), x, lignes.length > 1 ? 136 : 90);
      }
    });
    return carte;
  }

  function creerColonne(cat, items, angle) {
    const col = document.createElement('a-entity');
    const rad = angle * Math.PI / 180;
    col.setAttribute('position', (RAYON * Math.sin(rad)).toFixed(3) + ' 0 ' + (-RAYON * Math.cos(rad)).toFixed(3));
    col.setAttribute('rotation', '0 ' + (-angle) + ' 0');

    const entete = creerPanneau({
      largeur: LARGEUR,
      hauteur: 0.22,
      dessiner: function (ctx, w, h) {
        ctx.fillStyle = cat.couleur;
        arrondi(ctx, 0, 0, w, h, 24);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const libelle = cat.libelle + ' (' + items.length + ')';
        ajuster(ctx, libelle, w - 40, 48, true, 28);
        ctx.fillText(libelle, w / 2, h / 2 + 2);
      }
    });
    entete.setAttribute('position', '0 0.8 0');
    col.appendChild(entete);

    if (items.length === 0) {
      const vide = creerPanneau({
        largeur: LARGEUR,
        hauteur: 0.28,
        dessiner: function (ctx, w, h) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
          arrondi(ctx, 0, 0, w, h, 26);
          ctx.fill();
          ctx.fillStyle = '#c9d2e8';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = police(34, false, true);
          ctx.fillText('Aucun métier ici pour le moment', w / 2, h / 2);
        }
      });
      vide.setAttribute('position', '0 ' + (HAUT - 0.14) + ' 0');
      col.appendChild(vide);
      return col;
    }

    const d = disposition(items.length);
    const rangees = Math.ceil(items.length / d.sousColonnes);
    let i = 0;
    while (i < items.length) {
      const sousColonne = Math.floor(i / rangees);   // on remplit la 1re sous-colonne d'abord (ordre de lecture)
      const rang = i % rangees;
      const x = d.sousColonnes === 1 ? 0 : (sousColonne === 0 ? -1 : 1) * (d.l + ECART) / 2;
      const y = HAUT - d.h / 2 - rang * d.pas;
      const carte = creerCarte(cat, items[i], d.l, d.h);
      carte.setAttribute('position', x.toFixed(3) + ' ' + y.toFixed(3) + ' 0');
      col.appendChild(carte);
      i++;
    }
    return col;
  }
}
