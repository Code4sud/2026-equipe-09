// Point d'entrée E3 : écoute « partie-terminee » (émis par E2) et affiche
// le tableau de résultats puis les fiches métiers.
//
//   import { monterResultats } from './js/resultats/resultats.js';
//   const resultats = monterResultats(scene, { metiersUrl: 'data/metiers.json', parent, position });
//   scene.emit('partie-terminee', { profil, classement }); // classement = sortie de ranking.js

import { creerTableau } from './tableau.js';
import { creerFiche } from './fiche.js';
import { activer } from './canvas-panneau.js';

export function monterResultats(scene, options = {}) {
  const metiersUrl = options.metiersUrl || 'data/metiers.json';

  const racine = document.createElement('a-entity');
  racine.setAttribute('position', options.position || '0 1.3 0');
  racine.setAttribute('visible', false);
  (options.parent || scene).appendChild(racine);

  const metiers = new Map();
  const pret = fetch(metiersUrl)
    .then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + metiersUrl);
      return r.json();
    })
    .then(function (liste) {
      let i = 0;
      while (Array.isArray(liste) && i < liste.length) {
        if (liste[i] && liste[i].onet) metiers.set(liste[i].onet, liste[i]);
        i++;
      }
    })
    .catch(function (err) {
      console.error('[resultats] metiers.json illisible, les fiches seront « à venir » :', err);
    });

  // Garde-fous contre les clics involontaires :
  // - anti double-clic (regard + souris) : 500 ms entre deux clics ;
  // - au regard (fuse), un clic ne compte que si le joueur a posé les yeux sur
  //   l'élément APRÈS l'apparition de l'écran. Sinon le regard, resté au centre,
  //   ouvrirait tout seul la carte qui vient d'apparaître dessous.
  let bloqueJusqua = 0;
  let dernierChangement = 0;
  function garde(el, evt) {
    const t = Date.now();
    if (t < bloqueJusqua) return false;
    const curseur = evt && evt.detail && evt.detail.cursorEl;
    const auRegard = curseur && curseur.components.cursor && curseur.components.cursor.data.fuse;
    if (auRegard && el && el.survolDepuis && el.survolDepuis < dernierChangement + 1000) return false;
    bloqueJusqua = t + 500;
    return true;
  }

  const vus = new Set();
  let tableau = null;
  let classementCourant = [];

  const fiche = creerFiche({ garde, onRetour: function () { montrer('tableau'); } });
  racine.appendChild(fiche.el);
  activer(fiche.el, false);

  function montrer(vue) {
    dernierChangement = Date.now();
    bloqueJusqua = dernierChangement + 300;
    if (tableau) activer(tableau.el, vue === 'tableau');
    activer(fiche.el, vue === 'fiche');
  }

  function ouvrir(item, onglet) {
    fiche.afficher(item, metiers.get(item.onet), onglet || 0);
    montrer('fiche');
  }

  async function afficher(classement) {
    await pret;
    classementCourant = Array.isArray(classement) ? classement : [];
    if (tableau) racine.removeChild(tableau.el);
    tableau = creerTableau({ classement: classementCourant, metiers, vus, garde, onChoisir: ouvrir });
    racine.appendChild(tableau.el);
    racine.setAttribute('visible', true);
    montrer('tableau');
    scene.emit('resultats-affiches', { nb: classementCourant.length });
  }

  // Ouvre directement une fiche (tests, captures d'écran).
  function ouvrirFiche(onet, onglet) {
    let i = 0;
    while (i < classementCourant.length) {
      if (classementCourant[i].onet === onet) {
        vus.add(onet);
        ouvrir(classementCourant[i], onglet);
        return true;
      }
      i++;
    }
    return false;
  }

  scene.addEventListener('partie-terminee', function (e) {
    const classement = e.detail && e.detail.classement;
    if (!Array.isArray(classement)) {
      console.error('[resultats] « partie-terminee » sans classement valide :', e.detail);
      return;
    }
    afficher(classement);
  });

  return { afficher, ouvrirFiche, racine };
}
