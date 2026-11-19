// Réticule du regard (#gaze-hud de E1) aligné sur le point réellement visé.
//
// Le rayon de sélection part du centre de la caméra (#gaze-pointer) vers l'avant. On place
// l'anneau exactement à la distance du premier objet touché (un peu devant lui), et on l'agrandit
// d'autant pour garder la même taille apparente. Dans un casque, les deux yeux voient ainsi
// l'anneau sur la cible elle-même (et non flottant à 0,9 m, ce qui le dédoublait).
// Sans cible : l'anneau reste à 1,6 m devant le joueur.

const DISTANCE_REFERENCE = 0.9; // distance pour laquelle les rayons des anneaux sont dessinés (index.html)
const DISTANCE_SANS_CIBLE = 1.6;

export function alignerReticule(scene) {
  const hud = scene.querySelector('#gaze-hud');
  if (!hud) return;
  if (!window.AFRAME.components['reticule-aligne']) {
    window.AFRAME.registerComponent('reticule-aligne', {
      // Dessiné en dernier, par-dessus tout : sinon les panneaux semi-transparents (cartes,
      // boutons, fiches), dessinés après les objets opaques, recouvraient l'anneau.
      init() {
        this.el.object3D.traverse((o) => {
          if (o.isMesh) {
            o.renderOrder = 1000;
            o.material.transparent = true;
            o.material.depthTest = false;
            o.material.depthWrite = false;
          }
        });
        // Les anneaux peuvent finir de charger après : on recommence au premier passage.
        this.prepare = false;
      },
      tick() {
        if (!this.prepare) {
          let pret = true;
          this.el.object3D.traverse((o) => {
            if (o.isMesh) {
              o.renderOrder = 1000;
              o.material.transparent = true;
              o.material.depthTest = false;
            }
          });
          this.el.querySelectorAll('a-ring').forEach((r) => { if (!r.getObject3D('mesh')) pret = false; });
          this.prepare = pret;
        }
        const pointeur = this.el.parentEl;
        const rc = pointeur && pointeur.components.raycaster;
        const cible = rc && rc.intersections && rc.intersections[0];
        const d = cible ? Math.max(0.3, cible.distance - 0.02) : DISTANCE_SANS_CIBLE;
        this.el.object3D.position.set(0, 0, -d);
        this.el.object3D.scale.setScalar(d / DISTANCE_REFERENCE);
      }
    });
  }
  hud.setAttribute('reticule-aligne', '');
}
