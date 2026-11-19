// Caméra derrière le pion.
//
// On déplace le RIG du joueur (#player-rig), jamais la caméra elle-même : en VR, la tête
// reste libre (look-controls / casque), seul le « siège » glisse derrière le pion et
// s'oriente dans le sens du parcours. Le déplacement est adouci pour limiter l'inconfort.
//
// Les panneaux (carte et réponses du moteur, dé, résultats, boutons de E1) suivent le rig :
// ils gardent la place qu'ils avaient face au joueur assis au centre de la scène.

const RECUL = 2.2;        // distance derrière le pion (m)
const HAUTEUR = 1.6;      // hauteur des yeux du rig, au-dessus du pion
// Pendant la partie, la carte et les réponses montent un peu : le pion et les cases
// suivantes restent visibles sous la carte (et dans le cadre sur PC, champ vertical de 80°).
const DECALAGE_JEU = 0.35;
const DUREE = 900;        // durée d'un replacement (ms)
const RIG_INITIAL_Y = 1.3; // hauteur du rig dans index.html : référence des panneaux

const THREE = () => window.AFRAME.THREE;

// État partagé : où est le rig (lu par les panneaux qui le suivent).
const etat = { x: 0, y: RIG_INITIAL_Y, z: 0, lacet: 0, decalage: 0 };

function enregistrer() {
  if (window.AFRAME.components['suivre-joueur']) return;

  // Sur un panneau : garde sa position relative au joueur, quel que soit l'endroit du rig.
  window.AFRAME.registerComponent('suivre-joueur', {
    schema: { jeu: { default: false } },   // jeu : monte avec la carte pendant la partie
    init() {
      const p = this.el.getAttribute('position') || { x: 0, y: 0, z: 0 };
      const r = this.el.getAttribute('rotation') || { y: 0 };
      this.base = { x: p.x, y: p.y - RIG_INITIAL_Y, z: p.z, lacet: (r.y || 0) * Math.PI / 180 };
    },
    tick() {
      const b = this.base;
      const c = Math.cos(etat.lacet);
      const s = Math.sin(etat.lacet);
      const o = this.el.object3D;
      const dy = this.data.jeu ? etat.decalage : 0;
      o.position.set(etat.x + b.x * c + b.z * s, etat.y + b.y + dy, etat.z - b.x * s + b.z * c);
      o.rotation.y = b.lacet + etat.lacet;
    }
  });

  // Sur le rig : glisse en douceur vers sa cible.
  window.AFRAME.registerComponent('rig-suiveur', {
    init() {
      this.anim = null;
    },
    allerA(cible) {
      const o = this.el.object3D;
      let depart = etat.lacet;
      // Tourner par le plus court chemin.
      let arrivee = cible.lacet;
      while (arrivee - depart > Math.PI) arrivee -= 2 * Math.PI;
      while (arrivee - depart < -Math.PI) arrivee += 2 * Math.PI;
      this.anim = {
        debut: performance.now(),
        de: { x: o.position.x, y: o.position.y, z: o.position.z, lacet: depart, decalage: etat.decalage },
        a: { x: cible.x, y: cible.y, z: cible.z, lacet: arrivee, decalage: DECALAGE_JEU }
      };
    },
    tick() {
      const a = this.anim;
      const o = this.el.object3D;
      if (a) {
        const t = Math.min(1, (performance.now() - a.debut) / DUREE);
        const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // accélère puis freine
        etat.x = a.de.x + (a.a.x - a.de.x) * k;
        etat.y = a.de.y + (a.a.y - a.de.y) * k;
        etat.z = a.de.z + (a.a.z - a.de.z) * k;
        etat.lacet = a.de.lacet + (a.a.lacet - a.de.lacet) * k;
        etat.decalage = a.de.decalage + (a.a.decalage - a.de.decalage) * k;
        if (t >= 1) this.anim = null;
      }
      o.position.set(etat.x, etat.y, etat.z);
      o.rotation.y = etat.lacet;
    }
  });
}

// Panneaux à faire suivre (identifiants de la scène de E1).
export function attacherPanneaux(scene, selecteurs, options = {}) {
  enregistrer();
  let i = 0;
  while (i < selecteurs.length) {
    const el = scene.querySelector(selecteurs[i]);
    if (el && !el.hasAttribute('suivre-joueur')) el.setAttribute('suivre-joueur', { jeu: Boolean(options.jeu) });
    i++;
  }
}

// Ajoute un élément dans le repère du joueur (ex. le dé), à une position relative à ses yeux.
export function placerPresDuJoueur(el, relatif) {
  enregistrer();
  el.setAttribute('position', { x: relatif.x, y: relatif.y + RIG_INITIAL_Y, z: relatif.z });
  el.setAttribute('rotation', { x: 0, y: Math.atan2(-relatif.x, -relatif.z) * 180 / Math.PI, z: 0 }); // tourné vers le joueur
  el.setAttribute('suivre-joueur', { jeu: true });
}

// Cible derrière la case `index`, tournée vers la case suivante.
function cibleDerriere(points, index) {
  const p = points[index];
  const suivant = points[Math.min(index + 1, points.length - 1)];
  const precedent = points[Math.max(index - 1, 0)];
  let dx = suivant.x - p.x;
  let dz = suivant.z - p.z;
  if (index === points.length - 1 || Math.hypot(dx, dz) < 1e-6) {   // dernière case : sens d'arrivée
    dx = p.x - precedent.x;
    dz = p.z - precedent.z;
  }
  const n = Math.hypot(dx, dz) || 1;
  dx /= n;
  dz /= n;
  // La caméra regarde vers -z : lacet tel que l'avant (-sin, -cos) = (dx, dz).
  return { x: p.x - dx * RECUL, y: HAUTEUR, z: p.z - dz * RECUL, lacet: Math.atan2(-dx, -dz) };
}

export function suivreLePion(scene, game, plateau) {
  enregistrer();
  const rig = scene.querySelector('#player-rig');
  if (!rig.hasAttribute('rig-suiveur')) rig.setAttribute('rig-suiveur', '');
  const aller = (index) => {
    const points = plateau.points();
    if (points.length > 0) rig.components['rig-suiveur'].allerA(cibleDerriere(points, index));
  };
  const arrets = [
    game.on('game:ready', ({ board }) => aller(board.start)),
    game.on('pawn:moved', ({ to }) => aller(to))
  ];
  return () => {
    let i = 0;
    while (i < arrets.length) {
      arrets[i]();
      i++;
    }
  };
}
