// Fiche métier en VR : 7 onglets à gauche (gros boutons, pas de défilement),
// contenu paginé à droite, bouton retour vers le tableau.

import { categorie, titreMetier } from './format.js';
import { ONGLETS, construireRubriques } from './rubriques.js';
import { creerPanneau, creerBouton, arrondi, couper, ellipse, police, masquer } from './canvas-panneau.js';

const MARGE = 48;
const STYLES = {
  para: { taille: 40, gras: false, couleur: '#1b2133', retrait: 0, avant: 8 },
  sous: { taille: 40, gras: true, couleur: '#34447a', retrait: 0, avant: 24 },
  puce: { taille: 40, gras: false, couleur: '#1b2133', retrait: 44, avant: 8 },
  nd: { taille: 38, gras: false, italique: true, couleur: '#8a93a8', retrait: 0, avant: 8 },
  note: { taille: 32, gras: false, couleur: '#5b6478', retrait: 0, avant: 22 }
};

// Répartit les blocs en pages de lignes qui tiennent dans la hauteur disponible.
function mettreEnPage(ctx, blocs, largeur, hauteurDispo) {
  const pages = [[]];
  let y = 0;
  let i = 0;
  while (i < blocs.length) {
    const st = STYLES[blocs[i].type] || STYLES.para;
    ctx.font = police(st.taille, st.gras, st.italique);
    const lignes = couper(ctx, blocs[i].texte, largeur - st.retrait);
    const hLigne = Math.round(st.taille * 1.3);
    let j = 0;
    while (j < lignes.length) {
      const avant = j === 0 && y > 0 ? st.avant : 0;
      const besoin = blocs[i].type === 'sous' ? hLigne * 2 : hLigne; // pas de sous-titre orphelin
      if (y + avant + besoin > hauteurDispo && pages[pages.length - 1].length > 0) {
        pages.push([]);
        y = 0;
      } else {
        y += avant;
      }
      pages[pages.length - 1].push({ texte: lignes[j], st, y, puce: blocs[i].type === 'puce' && j === 0 });
      y += hLigne;
      j++;
    }
    i++;
  }
  return pages;
}

export function creerFiche({ onRetour, garde }) {
  const el = document.createElement('a-entity');
  el.setAttribute('position', '0 0 -2.3');

  let item = null;
  let metier = null;
  let rubriques = null;
  let onglet = 0;
  let page = 0;
  let nbPages = 1;

  const contenu = creerPanneau({
    largeur: 1.7,
    hauteur: 1.1,
    dessiner: function (ctx, w, h) {
      ctx.save();
      arrondi(ctx, 0, 0, w, h, 36);
      ctx.fillStyle = '#f7f8fc';
      ctx.fill();
      ctx.clip();
      if (!item) {
        ctx.restore();
        return;
      }
      const cat = categorie(item.categorie);
      ctx.fillStyle = cat.couleur;
      ctx.fillRect(0, 0, w, 150);
      ctx.restore();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = police(56, true);
      ctx.fillText(ellipse(ctx, titreMetier(item, metier), w - 2 * MARGE), MARGE, 22);
      ctx.font = police(32, false);
      ctx.fillText(cat.libelle, MARGE, 96);

      ctx.fillStyle = '#1b2133';
      ctx.font = police(44, true);
      ctx.fillText(ONGLETS[onglet].titre, MARGE, 176);

      const haut = 250;
      const bas = h - 70;
      const pages = mettreEnPage(ctx, rubriques[ONGLETS[onglet].cle], w - 2 * MARGE, bas - haut);
      nbPages = pages.length;
      if (page >= nbPages) page = nbPages - 1;

      const lignes = pages[page];
      let i = 0;
      while (i < lignes.length) {
        const l = lignes[i];
        ctx.font = police(l.st.taille, l.st.gras, l.st.italique);
        ctx.fillStyle = l.st.couleur;
        if (l.puce) ctx.fillText('•', MARGE + 8, haut + l.y);
        ctx.fillText(l.texte, MARGE + l.st.retrait, haut + l.y);
        i++;
      }
      if (nbPages > 1) {
        ctx.textAlign = 'right';
        ctx.font = police(30, false);
        ctx.fillStyle = '#5b6478';
        ctx.fillText('Page ' + (page + 1) + ' / ' + nbPages, w - MARGE, h - 56);
      }
    }
  });
  contenu.setAttribute('position', '0.25 0.2 0');
  el.appendChild(contenu);

  const onglets = [];
  let i = 0;
  while (i < ONGLETS.length) {
    const index = i;
    const bouton = creerBouton({
      largeur: 0.44,
      hauteur: 0.14,
      libelle: ONGLETS[index].court,
      estActif: function () { return index === onglet; },
      onClic: function (e) {
        if (!garde(this, e) || index === onglet) return;
        onglet = index;
        page = 0;
        redessiner();
      }
    });
    bouton.setAttribute('position', '-0.9 ' + (0.68 - index * 0.157).toFixed(3) + ' 0');
    el.appendChild(bouton);
    onglets.push(bouton);
    i++;
  }

  const retour = creerBouton({
    largeur: 0.8,
    hauteur: 0.16,
    libelle: '← Retour aux résultats',
    couleur: '#2e8b57',
    onClic: function (e) { if (garde(this, e)) onRetour(); }
  });
  retour.setAttribute('position', '-0.45 -0.55 0');
  el.appendChild(retour);

  const prec = creerBouton({
    largeur: 0.36, hauteur: 0.16, libelle: '‹ Page',
    onClic: function (e) { if (garde(this, e) && page > 0) { page--; redessiner(); } }
  });
  prec.setAttribute('position', '0.6 -0.55 0');
  el.appendChild(prec);

  const suiv = creerBouton({
    largeur: 0.36, hauteur: 0.16, libelle: 'Page ›',
    onClic: function (e) { if (garde(this, e) && page < nbPages - 1) { page++; redessiner(); } }
  });
  suiv.setAttribute('position', '0.98 -0.55 0');
  el.appendChild(suiv);

  function redessiner() {
    contenu.redessiner(); // calcule nbPages
    let j = 0;
    while (j < onglets.length) {
      onglets[j].redessiner();
      j++;
    }
    masquer(prec, nbPages <= 1 || page === 0);
    masquer(suiv, nbPages <= 1 || page >= nbPages - 1);
  }

  function afficher(nouvelItem, nouveauMetier, ongletDepart) {
    item = nouvelItem;
    metier = nouveauMetier || null;
    rubriques = construireRubriques(item, metier);
    onglet = ongletDepart >= 0 && ongletDepart < ONGLETS.length ? ongletDepart : 0;
    page = 0;
    redessiner();
  }

  return { el, afficher };
}
