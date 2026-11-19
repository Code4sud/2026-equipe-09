// Décor à 360° : ciel violet en dégradé, nuages et étoiles, dessiné une fois sur un canvas
// (projection équirectangulaire) et appliqué au <a-sky> de la scène de E1.
// Couleurs sombres et peu contrastées pour que les cases, les cartes et les boutons restent lisibles.

function nuage(ctx, x, y, largeur, hauteur, alpha) {
  // Plusieurs ellipses floues ; dessinées aussi décalées d'une largeur pour boucler sans couture.
  const w = ctx.canvas.width;
  let decalage = -w;
  while (decalage <= w) {
    let i = 0;
    while (i < 7) {
      const cx = x + decalage + (i - 3) * largeur * 0.16;
      const cy = y + Math.sin(i * 1.7) * hauteur * 0.25;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, largeur * 0.22);
      g.addColorStop(0, 'rgba(196, 170, 255, ' + alpha + ')');
      g.addColorStop(1, 'rgba(196, 170, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, largeur * 0.22, hauteur * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      i++;
    }
    decalage += w;
  }
}

function dessinerCiel(w, h, alea) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  // Haut du canvas = zénith, milieu = horizon, bas = sous le sol (masqué par le plateau).
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0B0A26');
  g.addColorStop(0.32, '#1E1650');
  g.addColorStop(0.47, '#3B2A7A');
  g.addColorStop(0.5, '#4A3388');
  g.addColorStop(1, '#17153F');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Étoiles : plus nombreuses vers le zénith, petites et douces.
  let i = 0;
  while (i < 900) {
    const y = Math.pow(alea(), 1.6) * h * 0.46;
    const x = alea() * w;
    const r = alea() < 0.92 ? 0.8 + alea() * 1.1 : 1.8 + alea() * 1.4;
    ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.35 + alea() * 0.6) + ')';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    i++;
  }
  // Nuages bas, près de l'horizon.
  i = 0;
  while (i < 16) {
    nuage(ctx, alea() * w, h * (0.36 + alea() * 0.11), w * (0.08 + alea() * 0.1), h * (0.025 + alea() * 0.03), 0.10 + alea() * 0.12);
    i++;
  }
  return c;
}

export function poserDecor(scene) {
  const ciel = scene.querySelector('a-sky');
  if (!ciel) return;
  let graine = 42;
  const alea = () => {
    graine = (graine * 16807) % 2147483647;
    return graine / 2147483647;
  };
  const THREE = window.AFRAME.THREE;
  const texture = new THREE.CanvasTexture(dessinerCiel(4096, 2048, alea));
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace;
  const appliquer = () => {
    const mesh = ciel.getObject3D('mesh');
    if (!mesh) return;
    mesh.material.map = texture;
    mesh.material.color.set('#FFFFFF');
    mesh.material.needsUpdate = true;
  };
  if (ciel.hasLoaded) appliquer();
  else ciel.addEventListener('loaded', appliquer, { once: true });
}
