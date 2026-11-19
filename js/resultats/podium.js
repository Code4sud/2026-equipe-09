// Podium des 3 premiers métiers du classement, dans l'ordre visuel 2 – 1 – 3 :
// le 1er au centre et plus haut, le 2e à gauche, le 3e à droite.
// Chaque métier ouvre sa fiche ; un bouton mène au tableau complet.
// Moins de 3 métiers : seules les marches disponibles sont affichées.

import { categorie, titreMetier, liste } from './format.js';
import { creerPanneau, creerBouton, arrondi, couper, ellipse, police, ajuster } from './canvas-panneau.js';

const MARCHES = [
  // rang, x, hauteur de la marche, couleur, lacet (tourné vers le joueur)
  { rang: 2, x: -0.95, haut: 0.32, couleur: '#AEB7C6', lacet: 18 },
  { rang: 1, x: 0, haut: 0.52, couleur: '#E6B422', lacet: 0 },
  { rang: 3, x: 0.95, haut: 0.22, couleur: '#C47A3A', lacet: -18 }
];
const SOL = -0.95;      // bas des marches (par rapport aux yeux du joueur)
const Z = -2.35;
const CARTE = { l: 0.86, h: 0.5 };

export function creerPodium({ classement, metiers, vus, garde, onChoisir, onTableau }) {
  const el = document.createElement('a-entity');

  const titre = creerPanneau({
    largeur: 2.0,
    hauteur: 0.3,
    dessiner(ctx, w) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = police(62, true);
      ctx.fillText('Ton podium des métiers', w / 2, 8);
      ctx.fillStyle = '#C9D2E8';
      ctx.font = police(36, false);
      ctx.fillText('Fixe un métier pour ouvrir sa fiche', w / 2, 92);
    }
  });
  titre.setAttribute('position', '0 0.62 ' + Z);
  el.appendChild(titre);

  let i = 0;
  while (i < MARCHES.length) {
    const m = MARCHES[i];
    const item = classement[m.rang - 1];
    if (item) el.appendChild(creerMarche(m, item));
    i++;
  }

  const bouton = creerBouton({
    largeur: 1.0,
    hauteur: 0.17,
    libelle: 'Voir tous mes métiers (' + classement.length + ') →',
    couleur: '#4B3CA2',
    onClic(e) {
      if (garde(this, e)) onTableau();
    }
  });
  bouton.setAttribute('position', '0 ' + (SOL - 0.16) + ' ' + (Z + 0.15));
  el.appendChild(bouton);

  return { el };

  function creerMarche(m, item) {
    const groupe = document.createElement('a-entity');
    groupe.setAttribute('position', m.x + ' 0 ' + (Z + (m.rang === 1 ? 0 : 0.12)));
    groupe.setAttribute('rotation', '0 ' + m.lacet + ' 0');

    // La marche, avec son numéro sur la face avant.
    const bloc = document.createElement('a-box');
    bloc.setAttribute('width', 0.8);
    bloc.setAttribute('depth', 0.4);
    bloc.setAttribute('height', m.haut);
    bloc.setAttribute('position', '0 ' + (SOL + m.haut / 2) + ' 0');
    bloc.setAttribute('material', 'shader: flat; color: ' + m.couleur);
    groupe.appendChild(bloc);
    const numero = creerPanneau({
      largeur: 0.4,
      hauteur: Math.min(0.3, m.haut * 0.9),
      dessiner(ctx, w, h) {
        ctx.fillStyle = '#1B2133';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = police(Math.round(h * 0.8), true);
        ctx.fillText(String(m.rang), w / 2, h / 2 + 4);
      }
    });
    numero.setAttribute('position', '0 ' + (SOL + m.haut / 2) + ' 0.201');
    groupe.appendChild(numero);

    // La carte du métier, posée sur la marche : cliquable.
    const metier = metiers.get(item.onet);
    const cat = categorie(item.categorie);
    const carte = creerPanneau({
      largeur: CARTE.l,
      hauteur: CARTE.h,
      cliquable: true,
      onClic(e) {
        if (!garde(this, e)) return;
        vus.add(item.onet);
        carte.redessiner();
        onChoisir(item);
      },
      dessiner(ctx, w, h) {
        ctx.save();
        arrondi(ctx, 0, 0, w, h, 30);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = m.couleur;
        ctx.fillRect(0, 0, w, 20);
        ctx.restore();
        // médaille
        ctx.beginPath();
        ctx.arc(70, 92, 44, 0, Math.PI * 2);
        ctx.fillStyle = m.couleur;
        ctx.fill();
        ctx.fillStyle = '#1B2133';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = police(54, true);
        ctx.fillText(String(m.rang), 70, 96);
        // titre (2 lignes max)
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#1B2133';
        ctx.font = police(44, true);
        const lignes = couper(ctx, titreMetier(item, metier), w - 150);
        ctx.fillText(lignes[0] || '', 130, 44);
        if (lignes.length > 1) ctx.fillText(ellipse(ctx, lignes.slice(1).join(' '), w - 150), 130, 96);
        // catégorie + raison
        ctx.fillStyle = cat.couleur;
        ajuster(ctx, cat.libelle, w - 60, 32, true, 22);
        ctx.fillText(cat.libelle, 30, 170);
        const raison = !metier ? 'Fiche à venir' : (liste(item.raisons)[0] || 'Ouvre la fiche pour en savoir plus');
        ctx.fillStyle = '#5B6478';
        ctx.font = police(28, false);
        const l2 = couper(ctx, raison, w - 60);
        ctx.fillText(l2[0] || '', 30, 220);
        if (l2.length > 1) ctx.fillText(ellipse(ctx, l2.slice(1).join(' '), w - 60), 30, 256);
        if (vus.has(item.onet)) {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#2E8B57';
          ctx.font = police(28, true);
          ctx.fillText('✓ déjà vu', w - 24, 300);
        }
      }
    });
    carte.setAttribute('position', '0 ' + (SOL + m.haut + CARTE.h / 2 + 0.04) + ' 0.05');
    groupe.appendChild(carte);
    return groupe;
  }
}
