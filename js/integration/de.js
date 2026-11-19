// Dé 3D animé : ses 6 faces sont les 6 types de cartes (couleur + symbole + nom).
// À chaque lancer (« dice:rolling » du moteur), il tourne puis se pose en montrant
// au joueur la face du type de la case suivante.

const TYPES = ['preference', 'situation', 'decouverte', 'passerelle', 'surprise', 'pause'];
const TAILLE = 0.34;

// Rotation (en radians) qui amène chaque face de la BoxGeometry (+x, -x, +y, -y, +z, -z) face au joueur (+z local).
const ORIENTATIONS = [
  [0, -Math.PI / 2, 0],
  [0, Math.PI / 2, 0],
  [Math.PI / 2, 0, 0],
  [-Math.PI / 2, 0, 0],
  [0, 0, 0],
  [0, Math.PI, 0]
];

function texture(THREE, type) {
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

let enregistre = false;
function enregistrerComposant() {
  if (enregistre) return;
  enregistre = true;
  window.AFRAME.registerComponent('de-agora', {
    init() {
      this.anim = null;
    },
    lancer(face, duree) {
      const THREE = window.AFRAME.THREE;
      const cible = new THREE.Quaternion().setFromEuler(new THREE.Euler(...ORIENTATIONS[face]));
      const axe = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.anim = { debut: performance.now(), duree, cible, axe, depart: null };
    },
    // tick d'A-Frame : continue de tourner pendant une session WebXR (pas de requestAnimationFrame).
    tick() {
      const a = this.anim;
      const cube = this.el.getObject3D('mesh');
      if (!a || !cube) return;
      const p = Math.min(1, (performance.now() - a.debut) / a.duree);
      if (p < 0.65) {
        cube.rotateOnAxis(a.axe, 0.35 * (1 - p));             // tourne de plus en plus lentement
        cube.position.y = Math.abs(Math.sin(p * Math.PI * 3)) * 0.12; // petits rebonds
      } else {
        if (!a.depart) a.depart = cube.quaternion.clone();
        const q = (p - 0.65) / 0.35;
        cube.quaternion.copy(a.depart).slerp(a.cible, 1 - Math.pow(1 - q, 3));
        cube.position.y = 0;
      }
      if (p >= 1) {
        cube.quaternion.copy(a.cible);
        this.anim = null;
      }
    }
  });
}

export function creerDe(parent, game, typesInfo, position) {
  enregistrerComposant();
  const THREE = window.AFRAME.THREE;
  const el = document.createElement('a-entity');
  el.setAttribute('position', position);
  // Tourné vers le joueur (assis au centre de la scène).
  el.setAttribute('rotation', '0 ' + (Math.atan2(-position.x, -position.z) * 180 / Math.PI) + ' 0');
  const materiaux = [];
  let i = 0;
  while (i < TYPES.length) {
    materiaux.push(new THREE.MeshBasicMaterial({ map: texture(THREE, typesInfo[TYPES[i]]) }));
    i++;
  }
  const cube = new THREE.Mesh(new THREE.BoxGeometry(TAILLE, TAILLE, TAILLE), materiaux);
  cube.quaternion.setFromEuler(new THREE.Euler(0.4, -0.6, 0)); // posé de biais avant le 1er lancer
  el.setObject3D('mesh', cube);
  el.setAttribute('de-agora', '');
  parent.appendChild(el);

  let position_pion = 0;
  const arrets = [
    game.on('game:ready', ({ board }) => { position_pion = board.start; }),
    game.on('pawn:moved', ({ to }) => { position_pion = to; }),
    game.on('dice:rolling', ({ durationMs }) => {
      const board = game.getBoard();
      const suivante = board.cases[Math.min(position_pion + 1, board.cases.length - 1)];
      const face = Math.max(0, TYPES.indexOf(suivante.type));
      el.components['de-agora'].lancer(face, durationMs);
    })
  ];

  return {
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
