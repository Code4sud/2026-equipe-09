// Outils VR communs : panneaux dessinés sur canvas (texte net, accents OK,
// aucune police à télécharger), boutons, zones cliquables et raycasters.
// Nécessite A-Frame (globales AFRAME / THREE) chargé avant.

export const PPM = 700; // pixels de canvas par mètre de panneau
const POLICE = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';

export function police(taille, gras, italique) {
  return (italique ? 'italic ' : '') + (gras ? 'bold ' : '') + taille + 'px ' + POLICE;
}

export function arrondi(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Découpe un texte en lignes qui tiennent dans largeurMax (police déjà réglée).
export function couper(ctx, texte, largeurMax) {
  const mots = String(texte).split(/\s+/);
  const lignes = [];
  let ligne = '';
  let i = 0;
  while (i < mots.length) {
    if (mots[i] !== '') {
      const essai = ligne ? ligne + ' ' + mots[i] : mots[i];
      if (!ligne || ctx.measureText(essai).width <= largeurMax) ligne = essai;
      else {
        lignes.push(ligne);
        ligne = mots[i];
      }
    }
    i++;
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

export function ellipse(ctx, texte, largeurMax) {
  let t = String(texte);
  if (ctx.measureText(t).width <= largeurMax) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > largeurMax) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

// Réduit la taille de police jusqu'à ce que le texte tienne ; règle ctx.font.
export function ajuster(ctx, texte, largeurMax, taille, gras, mini) {
  let t = taille;
  ctx.font = police(t, gras);
  while (t > mini && ctx.measureText(texte).width > largeurMax) {
    t -= 2;
    ctx.font = police(t, gras);
  }
  return t;
}

// setTimeout et pas requestAnimationFrame : le rAF de la fenêtre est
// suspendu pendant une session WebXR immersive.
let rafraichissementPrevu = false;
export function rafraichirRaycasters() {
  if (rafraichissementPrevu) return;
  rafraichissementPrevu = true;
  setTimeout(function () {
    rafraichissementPrevu = false;
    const els = document.querySelectorAll('[raycaster]');
    let i = 0;
    while (i < els.length) {
      const rc = els[i].components && els[i].components.raycaster;
      if (rc) rc.refreshObjects();
      i++;
    }
  }, 0);
}

function estAffiche(el) {
  let parent = el.parentElement;
  while (parent && parent.tagName !== 'A-SCENE') {
    const visible = parent.getAttribute('visible');
    if (visible === false || visible === 'false') return false;
    parent = parent.parentElement;
  }
  return true;
}

// Affiche / cache un groupe ET retire la classe .clickable de ses zones cachées,
// pour ne jamais cliquer à travers un panneau invisible.
// On passe par le composant « visible » d'A-Frame : modifier object3D.visible
// directement serait écrasé quand l'entité finit de charger.
export function activer(racine, actif) {
  racine.setAttribute('visible', actif);
  const els = racine.querySelectorAll('[data-clic]');
  let i = 0;
  while (i < els.length) {
    els[i].classList.toggle('clickable', actif && els[i].dataset.masque !== '1');
    i++;
  }
  rafraichirRaycasters();
}

// Cache / montre un seul élément cliquable (ex. flèche de page).
export function masquer(el, masque) {
  el.dataset.masque = masque ? '1' : '';
  el.setAttribute('visible', !masque);
  el.classList.toggle('clickable', !masque && estAffiche(el));
  rafraichirRaycasters();
}

// Plan A-Frame dont la texture est un canvas redessinable (el.redessiner()).
export function creerPanneau({ largeur, hauteur, dessiner, cliquable = false, onClic = null }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(largeur * PPM);
  canvas.height = Math.round(hauteur * PPM);
  const texture = new THREE.CanvasTexture(canvas);
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const el = document.createElement('a-plane');
  el.setAttribute('width', largeur);
  el.setAttribute('height', hauteur);
  el.setAttribute('material', 'shader: flat; transparent: true');

  el.redessiner = function () {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dessiner(ctx, canvas.width, canvas.height);
    texture.needsUpdate = true;
  };
  el.redessiner();

  el.addEventListener('loaded', function (e) {
    if (e.target !== el) return;
    const mesh = el.getObject3D('mesh');
    if (!mesh) return;
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
    rafraichirRaycasters();
  });

  if (cliquable) {
    el.dataset.clic = '1';
    el.classList.add('clickable');
    el.addEventListener('mouseenter', function () {
      el.survolDepuis = Date.now();
      el.object3D.scale.set(1.04, 1.04, 1);
    });
    el.addEventListener('mouseleave', function () {
      el.survolDepuis = 0;
      el.object3D.scale.set(1, 1, 1);
    });
    if (onClic) el.addEventListener('click', onClic);
  }
  return el;
}

export function creerBouton({ largeur, hauteur, libelle, onClic, couleur = '#34447a', estActif = null }) {
  return creerPanneau({
    largeur,
    hauteur,
    cliquable: true,
    onClic,
    dessiner: function (ctx, w, h) {
      const actif = estActif ? estActif() : false;
      ctx.fillStyle = actif ? '#ffffff' : couleur;
      arrondi(ctx, 4, 4, w - 8, h - 8, Math.min(28, h / 3));
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.stroke();
      ctx.fillStyle = actif ? '#1b2133' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ajuster(ctx, libelle, w - 32, Math.round(h * 0.42), true, 18);
      ctx.fillText(libelle, w / 2, h / 2 + 2);
    }
  });
}
