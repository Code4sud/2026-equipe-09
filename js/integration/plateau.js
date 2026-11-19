// Plateau 3D : les cases du moteur (E2) en cercle au sol autour du joueur assis,
// sur l'anneau dessiné par la scène de E1 (rayon ~3,2 m), et un pion qui avance case par case.

const RAYON = 3.2;

function placer(index, taille) {
  const angle = (index / taille) * 2 * Math.PI;
  return { x: RAYON * Math.sin(angle), z: -RAYON * Math.cos(angle) };
}

export function creerPlateau(racine, game) {
  let arreter = null;

  function construire(board) {
    while (racine.firstChild) racine.removeChild(racine.firstChild);
    let i = 0;
    while (i < board.cases.length) {
      const c = board.cases[i];
      const p = placer(c.index, board.size);
      const dalle = document.createElement('a-entity');
      dalle.setAttribute('geometry', { primitive: 'cylinder', radius: 0.42, height: 0.06 });
      dalle.setAttribute('material', { color: c.color, shader: 'flat' });
      dalle.setAttribute('position', { x: p.x, y: 0.06, z: p.z });
      racine.appendChild(dalle);
      // Le sens de la case ne passe pas que par la couleur : symbole au-dessus de la dalle.
      if (c.symbol) {
        const symbole = document.createElement('a-text');
        symbole.setAttribute('value', c.symbol);
        symbole.setAttribute('align', 'center');
        symbole.setAttribute('color', '#FFFFFF');
        symbole.setAttribute('width', 4);
        symbole.setAttribute('position', { x: p.x, y: 0.1, z: p.z });
        symbole.setAttribute('rotation', '-90 0 0');
        racine.appendChild(symbole);
      }
      i++;
    }
    const pion = document.createElement('a-entity');
    pion.setAttribute('geometry', { primitive: 'cone', radiusBottom: 0.18, radiusTop: 0.02, height: 0.45 });
    pion.setAttribute('material', { color: '#FF63C8', shader: 'flat' });
    racine.appendChild(pion);

    const deplacer = (index) => {
      const p = placer(index, board.size);
      pion.setAttribute('position', { x: p.x, y: 0.32, z: p.z });
    };
    deplacer(board.start);
    return game.on('pawn:step', ({ position }) => deplacer(position));
  }

  const arreterPret = game.on('game:ready', ({ board }) => {
    if (arreter) arreter();
    arreter = construire(board);
  });

  return {
    detruire() {
      arreterPret();
      if (arreter) arreter();
      while (racine.firstChild) racine.removeChild(racine.firstChild);
    }
  };
}
