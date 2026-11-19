import { creerPanneau, police, ajuster } from '../resultats/canvas-panneau.js';

// Plateau en spirale au sol, autour du joueur assis : départ à l'extrémité extérieure,
// arrivée au centre (extrémité intérieure). Une case par tour.
// Les cases restent grises tant que le dé ne les a pas révélées, puis prennent la couleur
// et le symbole de leur type. Un pion avance case par case (« pawn:step » du moteur).

const R_EXT = 3.15;   // départ, sur l'anneau dessiné par la scène de E1
const R_INT = 1.05;   // arrivée, près des pieds du joueur sans être dessous
const ANGLE_DEPART = 50 * Math.PI / 180;   // devant à droite, hors de la zone cachée par la carte
const GRIS = '#3A3570';

// Points de la spirale espacés régulièrement (même distance entre deux cases).
function spirale(n) {
  const tours = 0.9 + n * 0.035;   // plus de cases -> plus de tours de spirale
  const fin = tours * 2 * Math.PI;
  const echantillons = [];
  const N = 2000;
  let longueur = 0;
  let k = 0;
  let precedent = null;
  while (k <= N) {
    const t = k / N;
    const a = ANGLE_DEPART + t * fin;
    const r = R_EXT - (R_EXT - R_INT) * t;
    const p = { x: r * Math.sin(a), z: -r * Math.cos(a) };
    if (precedent) longueur += Math.hypot(p.x - precedent.x, p.z - precedent.z);
    echantillons.push({ p, l: longueur });
    precedent = p;
    k++;
  }
  const points = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    const cible = n > 1 ? (longueur * i) / (n - 1) : 0;
    while (j < echantillons.length - 1 && echantillons[j].l < cible) j++;
    points.push(echantillons[j].p);
    i++;
  }
  return { points, pas: n > 1 ? longueur / (n - 1) : 1 };
}

function versJoueur(p) {
  return Math.atan2(-p.x, -p.z) * 180 / Math.PI;
}

// Textes dessinés sur canvas : la police intégrée d'A-Frame n'a ni les accents ni les symboles.
function panneauDebout(parent, valeur, p, hauteur, couleur) {
  const el = creerPanneau({
    largeur: 0.9,
    hauteur: 0.24,
    dessiner(ctx, w, h) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = couleur;
      ajuster(ctx, valeur, w - 20, 110, true, 40);
      ctx.fillText(valeur, w / 2, h / 2);
    }
  });
  el.setAttribute('position', { x: p.x, y: hauteur, z: p.z });
  el.setAttribute('rotation', '0 ' + versJoueur(p) + ' 0');
  parent.appendChild(el);
}

// Étiquette posée à plat sur une dalle, lisible depuis le siège ; contenu modifiable (révélation).
function etiquetteSol(parent, p, taille, contenu) {
  const pivot = document.createElement('a-entity');
  pivot.setAttribute('position', { x: p.x, y: 0.095, z: p.z });
  pivot.setAttribute('rotation', '0 ' + versJoueur(p) + ' 0');
  const el = creerPanneau({
    largeur: taille,
    hauteur: taille,
    dessiner(ctx, w, h) {
      if (!contenu.texte) return;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = contenu.couleur;
      ctx.font = police(Math.round(h * 0.5), true);
      ctx.fillText(contenu.texte, w / 2, h / 2);
    }
  });
  el.setAttribute('rotation', '-90 0 0');
  pivot.appendChild(el);
  parent.appendChild(pivot);
  return el;
}

export function creerPlateau(racine, game) {
  let arrets = [];
  let pointsCourants = [];

  function construire(board) {
    while (racine.firstChild) racine.removeChild(racine.firstChild);
    const { points, pas } = spirale(board.cases.length);
    pointsCourants = points;
    const rayon = Math.min(0.3, pas * 0.42);
    const dalles = [];
    const symboles = [];

    // Chemin : petits points entre deux cases.
    let i = 0;
    while (i < points.length - 1) {
      let s = 1;
      while (s < 3) {
        const a = points[i];
        const b = points[i + 1];
        const point = document.createElement('a-circle');
        point.setAttribute('radius', 0.035);
        point.setAttribute('rotation', '-90 0 0');
        point.setAttribute('material', 'shader: flat; color: #7468F3');
        point.setAttribute('position', { x: a.x + (b.x - a.x) * s / 3, y: 0.06, z: a.z + (b.z - a.z) * s / 3 });
        racine.appendChild(point);
        s++;
      }
      i++;
    }

    i = 0;
    while (i < board.cases.length) {
      const p = points[i];
      const dalle = document.createElement('a-entity');
      dalle.setAttribute('geometry', { primitive: 'cylinder', radius: rayon, height: 0.06, segmentsRadial: 32 });
      dalle.setAttribute('material', { color: i === 0 ? '#FFFFFF' : GRIS, shader: 'flat' });
      dalle.setAttribute('position', { x: p.x, y: 0.06, z: p.z });
      racine.appendChild(dalle);
      dalles.push(dalle);
      const contenu = { texte: i === 0 ? '' : String(i), couleur: '#D2CBFF' };
      symboles.push({ contenu, el: etiquetteSol(racine, p, rayon * 1.5, contenu) });
      i++;
    }
    panneauDebout(racine, 'DÉPART', points[0], 0.45, '#FFFFFF');
    panneauDebout(racine, 'ARRIVÉE', points[points.length - 1], 0.45, '#FF63C8');

    const pion = document.createElement('a-entity');
    pion.setAttribute('geometry', { primitive: 'cone', radiusBottom: 0.22, radiusTop: 0.02, height: 0.6 });
    pion.setAttribute('material', { color: '#FF63C8', shader: 'flat' });
    racine.appendChild(pion);

    const deplacer = (index) => {
      const p = points[index];
      pion.setAttribute('position', { x: p.x, y: 0.39, z: p.z });
    };
    // Le dé révèle la case : elle prend la couleur et le symbole de son type.
    const reveler = (index) => {
      const c = board.cases[index];
      if (!c || index === 0) return;
      dalles[index].setAttribute('material', 'color', c.color);
      symboles[index].contenu.texte = c.symbol || String(index);
      symboles[index].contenu.couleur = c.textColor || '#FFFFFF';
      symboles[index].el.redessiner();
    };
    deplacer(board.start);
    return [
      game.on('pawn:step', ({ position }) => deplacer(position)),
      game.on('pawn:moving', ({ to }) => reveler(to))
    ];
  }

  const arreterPret = game.on('game:ready', ({ board }) => {
    let k = 0;
    while (k < arrets.length) {
      arrets[k]();
      k++;
    }
    arrets = construire(board);
  });

  return {
    // Position au sol de chaque case (pour la caméra qui suit le pion).
    points() {
      return pointsCourants;
    },
    detruire() {
      arreterPret();
      let k = 0;
      while (k < arrets.length) {
        arrets[k]();
        k++;
      }
      while (racine.firstChild) racine.removeChild(racine.firstChild);
    }
  };
}
