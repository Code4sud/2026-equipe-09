// Texte en relief (vraie géométrie 3D, extrusion légère) pour les chiffres et les libellés.
//
// Police : Droid Sans Bold au format typeface (assets/fonts/, licence Apache 2.0), qui contient
// les accents français. Les contours des lettres sont extrudés avec THREE.ExtrudeGeometry du
// three.js d'A-Frame : aucune bibliothèque en plus. Faces avant claires, flancs plus sombres :
// le relief se voit dès qu'on regarde un peu de biais, sans gêner la lecture de face.
//
//   creerTexte3D({ texte, taille, largeurMax, lignesMax, couleur, couleurFlanc, profondeur })
//   -> <a-entity> centrée sur (0, 0, 0), le texte étant posé sur le plan z = 0 et sortant vers +z.

export const URL_POLICE = 'assets/fonts/droid_sans_bold.typeface.json';
const REMPLACEMENTS = { '←': '‹', '→': '›' };   // flèches absentes de la police
// Mesures de Droid Sans Bold (unités de la police) : H = 992 de haut ; ascendante 1290,
// descendante -328 -> interligne de (1290 + 328) / 992 ≈ 1,63 hauteur de majuscule.
const HAUTEUR_MAJUSCULE = 992;
const INTERLIGNE = 1.63;

let police = null;
let chargement = null;
const cacheGeometries = new Map();

export function chargerPolice() {
  if (!chargement) {
    chargement = fetch(URL_POLICE)
      .then((r) => {
        if (!r.ok) throw new Error(r.status + ' ' + URL_POLICE);
        return r.json();
      })
      .then((donnees) => {
        police = donnees;
        return donnees;
      });
  }
  return chargement;
}

export function glypheDisponible(caractere) {
  return Boolean(police && police.glyphs[REMPLACEMENTS[caractere] || caractere]);
}

function normaliser(texte) {
  let sortie = '';
  let i = 0;
  const s = String(texte);
  while (i < s.length) {
    const c = REMPLACEMENTS[s[i]] || s[i];
    sortie += c === ' ' || c === ' ' ? ' ' : c;
    i++;
  }
  return sortie;
}

function largeur(mot, echelle) {
  let l = 0;
  let i = 0;
  while (i < mot.length) {
    const g = police.glyphs[mot[i]] || police.glyphs['?'];
    l += g.ha * echelle;
    i++;
  }
  return l;
}

// Coupe en lignes qui tiennent dans largeurMax ; renvoie null si plus de lignesMax lignes.
function couperLignes(texte, echelle, largeurMax, lignesMax) {
  const mots = texte.split(' ');
  const lignes = [];
  let ligne = '';
  let i = 0;
  while (i < mots.length) {
    const essai = ligne ? ligne + ' ' + mots[i] : mots[i];
    if (!ligne || largeur(essai, echelle) <= largeurMax) ligne = essai;
    else {
      lignes.push(ligne);
      ligne = mots[i];
    }
    i++;
  }
  if (ligne) lignes.push(ligne);
  let k = 0;
  while (k < lignes.length) {
    if (largeur(lignes[k], echelle) > largeurMax) return null;
    k++;
  }
  return lignes.length <= lignesMax ? lignes : null;
}

// Contours d'une ligne de texte (même algorithme que FontLoader de three.js).
function contoursLigne(THREE, ligne, echelle, x0, y0, formes) {
  let x = x0;
  let i = 0;
  while (i < ligne.length) {
    const g = police.glyphs[ligne[i]] || police.glyphs['?'];
    if (g.o) {
      const o = g._decoupe || (g._decoupe = g.o.split(' '));
      const chemin = new THREE.ShapePath();
      let k = 0;
      while (k < o.length) {
        const action = o[k++];
        if (action === 'm' || action === 'l') {
          const px = o[k++] * echelle + x;
          const py = o[k++] * echelle + y0;
          if (action === 'm') chemin.moveTo(px, py);
          else chemin.lineTo(px, py);
        } else if (action === 'q') {
          const px = o[k++] * echelle + x;
          const py = o[k++] * echelle + y0;
          const c1x = o[k++] * echelle + x;
          const c1y = o[k++] * echelle + y0;
          chemin.quadraticCurveTo(c1x, c1y, px, py);
        } else if (action === 'b') {
          const px = o[k++] * echelle + x;
          const py = o[k++] * echelle + y0;
          const c1x = o[k++] * echelle + x;
          const c1y = o[k++] * echelle + y0;
          const c2x = o[k++] * echelle + x;
          const c2y = o[k++] * echelle + y0;
          chemin.bezierCurveTo(c1x, c1y, c2x, c2y, px, py);
        }
      }
      const f = chemin.toShapes();
      let j = 0;
      while (j < f.length) {
        formes.push(f[j]);
        j++;
      }
    }
    x += g.ha * echelle;
    i++;
  }
}

function geometrie(THREE, texte, taille, largeurMax, lignesMax, profondeur, alignement) {
  const cle = [texte, taille, largeurMax, lignesMax, profondeur, alignement].join('|');
  if (cacheGeometries.has(cle)) return cacheGeometries.get(cle);
  // La taille demandée est la hauteur des majuscules ; on réduit si le texte ne tient pas.
  let t = taille;
  let lignes = null;
  while (t > taille * 0.45) {
    lignes = couperLignes(texte, t / HAUTEUR_MAJUSCULE, largeurMax, lignesMax);
    if (lignes) break;
    t *= 0.92;
  }
  const echelle = t / HAUTEUR_MAJUSCULE;
  if (!lignes) lignes = couperLignes(texte, echelle, Infinity, 99);
  const interligne = t * INTERLIGNE;
  const formes = [];
  let i = 0;
  while (i < lignes.length) {
    const l = largeur(lignes[i], echelle);
    const x0 = alignement === 'gauche' ? -largeurMax / 2 : -l / 2;
    const y0 = -t / 2 + ((lignes.length - 1) / 2 - i) * interligne;
    contoursLigne(THREE, lignes[i], echelle, x0, y0, formes);
    i++;
  }
  const g = new THREE.ExtrudeGeometry(formes, {
    depth: profondeur,
    curveSegments: 4,
    bevelEnabled: true,
    bevelThickness: profondeur * 0.25,
    bevelSize: t * 0.012,
    bevelSegments: 1
  });
  if (cacheGeometries.size > 400) cacheGeometries.clear();
  cacheGeometries.set(cle, g);
  return g;
}

export function creerTexte3D({
  texte, taille = 0.06, largeurMax = 1, lignesMax = 2,
  couleur = '#FFFFFF', couleurFlanc = '#6A5FB8', profondeur = 0.012, alignement = 'centre'
}) {
  const el = document.createElement('a-entity');
  const THREE = window.AFRAME.THREE;
  const contenu = normaliser(texte);
  const materiaux = [
    new THREE.MeshBasicMaterial({ color: couleur }),       // faces avant et arrière
    new THREE.MeshBasicMaterial({ color: couleurFlanc })   // flancs de l'extrusion
  ];
  const poser = () => {
    const mesh = new THREE.Mesh(geometrie(THREE, contenu, taille, largeurMax, lignesMax, profondeur, alignement), materiaux);
    // Transparent au curseur : le rayon touche le bouton derrière, pas les lettres.
    mesh.raycast = function () {};
    el.setObject3D('mesh', mesh);
  };
  el.changerCouleur = (face, flanc) => {
    materiaux[0].color.set(face);
    if (flanc) materiaux[1].color.set(flanc);
  };
  if (police) poser();
  else chargerPolice().then(poser).catch((e) => console.warn('[agora] police 3D indisponible :', e));
  return el;
}
