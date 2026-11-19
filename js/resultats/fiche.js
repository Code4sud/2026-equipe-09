// Fiche métier en VR, thème sombre : onglets à gauche (seulement ceux qui ont du contenu),
// texte court et gros à droite, sources en une petite ligne en bas, bouton retour aux résultats.

import { categorie, titreMetier } from './format.js';
import { construireFiche } from './rubriques.js';
import { creerPanneau, creerBouton, arrondi, couper, ellipse, police, masquer } from './canvas-panneau.js';

const MARGE = 52;
const FOND = '#1C1838';
const STYLES = {
  para: { taille: 44, gras: false, couleur: '#ECE7FF', retrait: 0, avant: 10 },
  sous: { taille: 38, gras: true, couleur: '#BFB2FF', retrait: 0, avant: 26 },
  puce: { taille: 44, gras: false, couleur: '#ECE7FF', retrait: 46, avant: 10 },
  note: { taille: 32, gras: false, italique: true, couleur: '#A79DD6', retrait: 0, avant: 26 }
};
const ONGLET = { l: 0.44, h: 0.14, pas: 0.157, haut: 0.68 };

// Répartit les blocs en pages de lignes (rarement plus d'une page : les textes sont courts).
function mettreEnPage(ctx, blocs, largeur, hauteurDispo, echelle = 1) {
  const pages = [[]];
  let y = 0;
  let i = 0;
  while (i < blocs.length) {
    const base = STYLES[blocs[i].type] || STYLES.para;
    const st = { ...base, taille: Math.round(base.taille * echelle) };
    ctx.font = police(st.taille, st.gras, st.italique);
    const lignes = couper(ctx, blocs[i].texte, largeur - st.retrait);
    const hLigne = Math.round(st.taille * 1.3);
    let j = 0;
    while (j < lignes.length) {
      const avant = j === 0 && y > 0 ? st.avant : 0;
      const besoin = blocs[i].type === 'sous' ? hLigne * 2 : hLigne;
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
  let fiche = { onglets: [], sources: '' };
  let onglet = 0;
  let page = 0;
  let nbPages = 1;

  const contenu = creerPanneau({
    largeur: 1.7,
    hauteur: 1.1,
    dessiner: function (ctx, w, h) {
      const cat = item ? categorie(item.categorie) : { couleur: '#5c6b8a', libelle: '' };
      ctx.save();
      arrondi(ctx, 0, 0, w, h, 36);
      ctx.fillStyle = FOND;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = cat.couleur;
      ctx.fillRect(0, 0, w, 150);
      ctx.restore();
      arrondi(ctx, 3, 3, w - 6, h - 6, 34);
      ctx.lineWidth = 6;
      ctx.strokeStyle = cat.couleur;
      ctx.stroke();
      if (!item || fiche.onglets.length === 0) return;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = police(58, true);
      ctx.fillText(ellipse(ctx, titreMetier(item, metier), w - 2 * MARGE), MARGE, 22);
      ctx.font = police(32, false);
      ctx.fillText(cat.libelle, MARGE, 98);

      const courant = fiche.onglets[onglet];
      ctx.fillStyle = '#FFFFFF';
      ctx.font = police(46, true);
      ctx.fillText(courant.titre, MARGE, 180);

      const haut = 256;
      const bas = h - 76;
      // Une seule page si possible : on réduit un peu le texte (jusqu'à -20 %) avant de paginer.
      const echelles = [1, 0.9, 0.8];
      let pages = null;
      let k = 0;
      while (k < echelles.length) {
        pages = mettreEnPage(ctx, courant.blocs, w - 2 * MARGE, bas - haut, echelles[k]);
        if (pages.length === 1) break;
        k++;
      }
      nbPages = pages.length;
      if (page >= nbPages) page = nbPages - 1;
      const lignes = pages[page];
      let i = 0;
      while (i < lignes.length) {
        const l = lignes[i];
        ctx.font = police(l.st.taille, l.st.gras, l.st.italique);
        if (l.puce) {
          ctx.fillStyle = '#FF86D4';
          ctx.fillText('•', MARGE + 8, haut + l.y);
        }
        ctx.fillStyle = l.st.couleur;
        ctx.fillText(l.texte, MARGE + l.st.retrait, haut + l.y);
        i++;
      }
      // Sources : une petite ligne discrète en bas.
      ctx.font = police(26, false);
      ctx.fillStyle = '#8F86C2';
      ctx.textAlign = 'left';
      if (fiche.sources) ctx.fillText(ellipse(ctx, 'Sources : ' + fiche.sources, w - 2 * MARGE - 160), MARGE, h - 52);
      if (nbPages > 1) {
        ctx.textAlign = 'right';
        ctx.fillText((page + 1) + ' / ' + nbPages, w - MARGE, h - 52);
      }
    }
  });
  contenu.setAttribute('position', '0.25 0.2 0');
  el.appendChild(contenu);

  // Onglets : recréés à chaque fiche (leur nombre dépend des informations disponibles).
  const zoneOnglets = document.createElement('a-entity');
  el.appendChild(zoneOnglets);
  let boutonsOnglets = [];

  function creerOnglets() {
    while (zoneOnglets.firstChild) zoneOnglets.removeChild(zoneOnglets.firstChild);
    boutonsOnglets = [];
    let i = 0;
    while (i < fiche.onglets.length) {
      const index = i;
      const bouton = creerBouton({
        largeur: ONGLET.l,
        hauteur: ONGLET.h,
        libelle: fiche.onglets[index].court,
        couleur: '#2E2760',
        estActif: function () { return index === onglet; },
        onClic: function (e) {
          if (!garde(this, e) || index === onglet) return;
          onglet = index;
          page = 0;
          redessiner();
        }
      });
      bouton.setAttribute('position', '-0.9 ' + (ONGLET.haut - index * ONGLET.pas).toFixed(3) + ' 0');
      zoneOnglets.appendChild(bouton);
      boutonsOnglets.push(bouton);
      i++;
    }
  }

  const retour = creerBouton({
    largeur: 0.8,
    hauteur: 0.16,
    libelle: '← Résultats',
    couleur: '#3B3180',
    onClic: function (e) { if (garde(this, e)) onRetour(); }
  });
  retour.setAttribute('position', '-0.45 -0.55 0');
  el.appendChild(retour);

  const prec = creerBouton({
    largeur: 0.36, hauteur: 0.16, libelle: '‹ Page', couleur: '#2E2760',
    onClic: function (e) { if (garde(this, e) && page > 0) { page--; redessiner(); } }
  });
  prec.setAttribute('position', '0.6 -0.55 0');
  el.appendChild(prec);

  const suiv = creerBouton({
    largeur: 0.36, hauteur: 0.16, libelle: 'Page ›', couleur: '#2E2760',
    onClic: function (e) { if (garde(this, e) && page < nbPages - 1) { page++; redessiner(); } }
  });
  suiv.setAttribute('position', '0.98 -0.55 0');
  el.appendChild(suiv);

  function redessiner() {
    contenu.redessiner(); // calcule nbPages
    let j = 0;
    while (j < boutonsOnglets.length) {
      boutonsOnglets[j].redessiner();
      j++;
    }
    masquer(prec, nbPages <= 1 || page === 0);
    masquer(suiv, nbPages <= 1 || page >= nbPages - 1);
  }

  function afficher(nouvelItem, nouveauMetier, ongletDepart) {
    item = nouvelItem;
    metier = nouveauMetier || null;
    fiche = construireFiche(item, metier);
    onglet = ongletDepart >= 0 && ongletDepart < fiche.onglets.length ? ongletDepart : 0;
    page = 0;
    creerOnglets();   // la fiche est ensuite affichée par montrer('fiche'), qui active les onglets
    redessiner();
  }

  return { el, afficher };
}
