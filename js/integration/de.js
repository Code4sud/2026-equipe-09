// Dé 3D animé. 5 faces = 5 types de cartes (couleur + symbole + nom), la 6e face est
// « Centre des Possibles » (logo officiel, assets/centre-des-possibles.png).
//
// À chaque lancer (« dice:rolling » du moteur) le dé tourne puis se pose sur la face tirée.
// Face « Centre des Possibles » : le dé s'y pose, un bandeau annonce le tirage, puis le dé
// pivote vers la face du type tiré au hasard (préférence, situation, passerelle, découverte
// ou surprise). Ce type est celui de la case suivante : le tour se déroule ensuite
// normalement, avec une seule carte. Le temps supplémentaire est donné par main.js
// (fonction `wait` du moteur, voir DUREE_CENTRE).

import { creerPanneau, police, arrondi, ajuster } from '../resultats/canvas-panneau.js';

export const FACES = ['preference', 'situation', 'decouverte', 'passerelle', 'surprise', 'centre'];
export const DUREE_CENTRE = 2200; // temps ajouté au lancer quand le dé tombe sur le Centre (ms)
export const LOGO_CENTRE = 'assets/centre-des-possibles.png';
const TAILLE = 0.34;
const VIOLET = '#28235B';

// Rotation qui amène chaque face de la BoxGeometry (+x, -x, +y, -y, +z, -z) face au joueur (+z local).
const ORIENTATIONS = [
  [0, -Math.PI / 2, 0],
  [0, Math.PI / 2, 0],
  [Math.PI / 2, 0, 0],
  [-Math.PI / 2, 0, 0],
  [0, 0, 0],
  [0, Math.PI, 0]
];

function faceType(THREE, type) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = type.color;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 236, 236);
  ctx.fillStyle = type.textColor || '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 120px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText(type.symbol, 128, 108);
  ctx.font = 'bold 34px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText(type.label, 128, 205);
  const t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Face « Centre des Possibles » : le logo s'il se charge, sinon le nom en texte.
function faceCentre(THREE) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  const fond = () => {
    ctx.fillStyle = VIOLET;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#FF63C8';
    ctx.lineWidth = 10;
    ctx.strokeRect(10, 10, 236, 236);
  };
  fond();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 38px system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillText('CENTRE', 128, 86);
  ctx.fillText('DES', 128, 128);
  ctx.fillText('POSSIBLES', 128, 170);
  const t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    fond();
    const k = Math.min(220 / img.width, 220 / img.height);
    ctx.drawImage(img, 128 - (img.width * k) / 2, 128 - (img.height * k) / 2, img.width * k, img.height * k);
    t.needsUpdate = true;
  };
  img.onerror = () => console.warn('[agora] logo introuvable : ajoutez-le dans ' + LOGO_CENTRE + ' (le nom reste affiché sur le dé).');
  img.src = LOGO_CENTRE;
  return t;
}

function enregistrerComposant() {
  if (window.AFRAME.components['de-agora']) return;
  window.AFRAME.registerComponent('de-agora', {
    init() {
      this.anim = null;
    },
    // etapes : faces sur lesquelles le dé se pose successivement ([face] ou [centre, type tiré]).
    // reperes : [[avancement 0-1, fonction]] appelées une fois quand l'animation les atteint.
    lancer(etapes, duree, reperes) {
      const THREE = window.AFRAME.THREE;
      const cibles = [];
      let i = 0;
      while (i < etapes.length) {
        cibles.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(...ORIENTATIONS[etapes[i]])));
        i++;
      }
      const axe = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.anim = { debut: performance.now(), duree, cibles, axe, depart: null, depart2: null, reperes: (reperes || []).slice() };
    },
    // tick d'A-Frame : continue de tourner pendant une session WebXR (pas de requestAnimationFrame).
    tick() {
      const a = this.anim;
      const cube = this.el.getObject3D('mesh');
      if (!a || !cube) return;
      const p = Math.min(1, (performance.now() - a.debut) / a.duree);
      while (a.reperes.length > 0 && p >= a.reperes[0][0]) a.reperes.shift()[1]();
      const deuxTemps = a.cibles.length > 1;
      // Un temps : roule (0 → 65 %) puis se pose. Deux temps : roule, se pose sur le Centre,
      // reste visible, puis pivote vers le type tiré (75 → 100 %).
      const finRoule = deuxTemps ? 0.3 : 0.65;
      const finPose = deuxTemps ? 0.45 : 1;
      if (p < finRoule) {
        cube.rotateOnAxis(a.axe, 0.35 * (1 - p / finRoule));
        cube.position.y = Math.abs(Math.sin((p / finRoule) * Math.PI * 3)) * 0.12;
      } else if (p < finPose) {
        if (!a.depart) a.depart = cube.quaternion.clone();
        const q = (p - finRoule) / (finPose - finRoule);
        cube.quaternion.copy(a.depart).slerp(a.cibles[0], 1 - Math.pow(1 - q, 3));
        cube.position.y = 0;
      } else if (deuxTemps && p < 0.75) {
        cube.quaternion.copy(a.cibles[0]);
      } else if (deuxTemps) {
        if (!a.depart2) a.depart2 = cube.quaternion.clone();
        const q = (p - 0.75) / 0.25;
        cube.quaternion.copy(a.depart2).slerp(a.cibles[1], 1 - Math.pow(1 - q, 3));
      }
      if (p >= 1) {
        cube.quaternion.copy(a.cibles[a.cibles.length - 1]);
        this.anim = null;
      }
    }
  });
}

// lancers[i] = { face, type } pour la case i (face 'centre' : type tiré au hasard parmi les 5).
export function creerDe(parent, game, typesInfo, lancers) {
  enregistrerComposant();
  const THREE = window.AFRAME.THREE;
  const el = document.createElement('a-entity');
  const materiaux = [];
  let i = 0;
  while (i < FACES.length) {
    const t = FACES[i] === 'centre' ? faceCentre(THREE) : faceType(THREE, typesInfo[FACES[i]]);
    materiaux.push(new THREE.MeshBasicMaterial({ map: t }));
    i++;
  }
  const cube = new THREE.Mesh(new THREE.BoxGeometry(TAILLE, TAILLE, TAILLE), materiaux);
  cube.quaternion.setFromEuler(new THREE.Euler(0.4, -0.6, 0)); // posé de biais avant le 1er lancer
  el.setObject3D('mesh', cube);
  el.setAttribute('de-agora', '');

  // Bandeau au-dessus du dé pour annoncer le tirage du Centre des Possibles.
  const message = { texte: '', couleur: '#FFFFFF' };
  const bandeau = creerPanneau({
    largeur: 0.9,
    hauteur: 0.26,
    dessiner(ctx, w, h) {
      if (!message.texte) return;
      arrondi(ctx, 0, 0, w, h, 30);
      ctx.fillStyle = VIOLET;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#FF63C8';
      ctx.stroke();
      ctx.fillStyle = message.couleur;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lignes = message.texte.split('\n');
      ajuster(ctx, lignes[0], w - 40, 46, true, 24);
      ctx.fillText(lignes[0], w / 2, lignes.length > 1 ? h * 0.32 : h / 2);
      if (lignes.length > 1) {
        ctx.font = police(54, true);
        ctx.fillText(lignes[1], w / 2, h * 0.7);
      }
    }
  });
  bandeau.setAttribute('position', '0 0.36 0');
  bandeau.setAttribute('visible', false);
  el.appendChild(bandeau);
  parent.appendChild(el);

  const annoncer = (texte, couleur) => {
    message.texte = texte;
    message.couleur = couleur || '#FFFFFF';
    bandeau.redessiner();
    bandeau.setAttribute('visible', Boolean(texte));
  };

  let positionPion = 0;
  const arrets = [
    game.on('game:ready', ({ board }) => { positionPion = board.start; }),
    game.on('pawn:moved', ({ to }) => {
      positionPion = to;
      annoncer('');
    }),
    game.on('dice:rolling', ({ durationMs }) => {
      const lancer = lancers[Math.min(positionPion + 1, lancers.length - 1)];
      const de = el.components['de-agora'];
      if (lancer.face === 'centre') {
        const tire = typesInfo[lancer.type];
        annoncer('');
        de.lancer([FACES.indexOf('centre'), FACES.indexOf(lancer.type)], durationMs + DUREE_CENTRE, [
          [0.45, () => annoncer('Centre des Possibles !\nTirage au sort…')],   // posé sur le logo
          [0.75, () => annoncer('Le Centre a tiré :\n' + tire.label)]          // pivote vers le type
        ]);
      } else {
        annoncer('');
        de.lancer([FACES.indexOf(lancer.face)], durationMs);
      }
    })
  ];

  return {
    el,
    detruire() {
      let k = 0;
      while (k < arrets.length) {
        arrets[k]();
        k++;
      }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  };
}
