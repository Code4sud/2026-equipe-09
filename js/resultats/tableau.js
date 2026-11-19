// Tableau de résultats : 3 colonnes (une par catégorie) en arc autour du joueur assis.
// 4 métiers par page et par colonne, boutons Précédents / Suivants si besoin.

import { CATEGORIES, titreMetier, liste } from './format.js';
import { creerPanneau, creerBouton, arrondi, couper, ellipse, ajuster, police, masquer, rafraichirRaycasters } from './canvas-panneau.js';

const RAYON = 2.5;
const ANGLES = [-40, 0, 40];
const PAR_PAGE = 4;
const CARTE = { l: 1.0, h: 0.28, pas: 0.32, haut: 0.42 };

function grouper(classement) {
  const groupes = {};
  let c = 0;
  while (c < CATEGORIES.length) {
    groupes[CATEGORIES[c].cle] = [];
    c++;
  }
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
  titre.setAttribute('position', '0 1.05 ' + (-RAYON));
  el.appendChild(titre);

  let c = 0;
  while (c < CATEGORIES.length) {
    el.appendChild(creerColonne(CATEGORIES[c], groupes[CATEGORIES[c].cle], ANGLES[c]));
    c++;
  }
  return { el };

  function creerCarte(cat, item) {
    const metier = metiers.get(item.onet);
    const carte = creerPanneau({
      largeur: CARTE.l,
      hauteur: CARTE.h,
      cliquable: true,
      onClic: function (e) {
        if (!garde(this, e)) return;
        vus.add(item.onet);
        carte.redessiner();
        onChoisir(item);
      },
      dessiner: function (ctx, w, h) {
        ctx.save();
        arrondi(ctx, 0, 0, w, h, 26);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = cat.couleur;
        ctx.fillRect(0, 0, 24, h);
        ctx.restore();

        const x = 50;
        const largeurTexte = w - x - 30;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let largeurTitre = largeurTexte;
        if (vus.has(item.onet)) {
          ctx.font = police(28, true);
          ctx.fillStyle = cat.couleur;
          ctx.textAlign = 'right';
          ctx.fillText('✓ déjà vu', w - 24, 16);
          ctx.textAlign = 'left';
          largeurTitre = largeurTexte - 150;
        }
        ctx.fillStyle = '#1b2133';
        ctx.font = police(46, true);
        const lignes = couper(ctx, titreMetier(item, metier), largeurTitre);
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
      largeur: CARTE.l,
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
    entete.setAttribute('position', '0 0.75 0');
    col.appendChild(entete);

    const zone = document.createElement('a-entity');
    col.appendChild(zone);

    let page = 0;
    const nbPages = Math.max(1, Math.ceil(items.length / PAR_PAGE));
    const yNav = CARTE.haut - PAR_PAGE * CARTE.pas;

    const prec = creerBouton({
      largeur: 0.46, hauteur: 0.16, libelle: '‹ Précédents',
      onClic: function (e) { if (garde(this, e) && page > 0) { page--; remplir(); } }
    });
    prec.setAttribute('position', '-0.26 ' + yNav + ' 0');
    const suiv = creerBouton({
      largeur: 0.46, hauteur: 0.16, libelle: 'Suivants ›',
      onClic: function (e) { if (garde(this, e) && page < nbPages - 1) { page++; remplir(); } }
    });
    suiv.setAttribute('position', '0.26 ' + yNav + ' 0');
    col.appendChild(prec);
    col.appendChild(suiv);

    function remplir() {
      while (zone.firstChild) zone.removeChild(zone.firstChild);
      if (items.length === 0) {
        const vide = creerPanneau({
          largeur: CARTE.l,
          hauteur: CARTE.h,
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
        vide.setAttribute('position', '0 ' + CARTE.haut + ' 0');
        zone.appendChild(vide);
      }
      let i = page * PAR_PAGE;
      const fin = Math.min(items.length, i + PAR_PAGE);
      let rang = 0;
      while (i < fin) {
        const carte = creerCarte(cat, items[i]);
        carte.setAttribute('position', '0 ' + (CARTE.haut - rang * CARTE.pas).toFixed(3) + ' 0');
        zone.appendChild(carte);
        i++;
        rang++;
      }
      masquer(prec, nbPages <= 1 || page === 0);
      masquer(suiv, nbPages <= 1 || page >= nbPages - 1);
      rafraichirRaycasters();
    }
    remplir();
    return col;
  }
}
