// Écran « Combien de tours veux-tu jouer ? » affiché après la validation du code (E1).
// 4 gros boutons, sélection au regard ou à la souris. Renvoie une promesse du nombre choisi.

import { creerPanneau, creerBouton, police, arrondi, activer, ajuster } from '../resultats/canvas-panneau.js';

export const CHOIX_TOURS = [10, 15, 20, 25];
const SECONDES_PAR_TOUR = 36; // estimation pour l'affichage, à ajuster après les tests en casque

export function choisirNombreDeTours(parent) {
  return new Promise((resoudre) => {
    const el = document.createElement('a-entity');
    parent.appendChild(el);
    const apparition = Date.now();
    let choisi = false;

    const titre = creerPanneau({
      largeur: 2.0,
      hauteur: 0.62,
      dessiner(ctx, w, h) {
        arrondi(ctx, 0, 0, w, h, 40);
        ctx.fillStyle = '#28235B';
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.font = police(70, true);
        ctx.fillText('Combien de tours veux-tu jouer ?', w / 2, h * 0.36);
        ctx.fillStyle = '#D2CBFF';
        const sousTitre = 'Un tour = un lancer de dé et une carte. Tu arrives au centre au dernier tour.';
        ajuster(ctx, sousTitre, w - 80, 40, false, 24);
        ctx.fillText(sousTitre, w / 2, h * 0.72);
      }
    });
    titre.setAttribute('position', '0 0.55 0');
    el.appendChild(titre);

    let i = 0;
    while (i < CHOIX_TOURS.length) {
      const nb = CHOIX_TOURS[i];
      const minutes = Math.round((nb * SECONDES_PAR_TOUR) / 60);
      const bouton = creerBouton({
        largeur: 0.92,
        hauteur: 0.3,
        libelle: nb + ' tours · ≈ ' + minutes + ' min',
        couleur: '#4B3CA2',
        onClic(e) {
          // Au regard, un clic ne compte que si le joueur a posé les yeux sur le bouton
          // après l'apparition de l'écran (sinon le regard resté sur « OK » choisirait seul).
          const curseur = e && e.detail && e.detail.cursorEl;
          const auRegard = curseur && curseur.components.cursor && curseur.components.cursor.data.fuse;
          if (choisi || (auRegard && (!this.survolDepuis || this.survolDepuis < apparition + 1000))) return;
          choisi = true;
          activer(el, false);
          el.parentNode.removeChild(el);
          resoudre(nb);
        }
      });
      bouton.setAttribute('position', (i % 2 === 0 ? -0.5 : 0.5) + ' ' + (i < 2 ? 0.02 : -0.36) + ' 0');
      el.appendChild(bouton);
      i++;
    }
  });
}
