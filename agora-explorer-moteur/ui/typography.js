// Petites aides d'affichage du texte, partagées par l'interface PC et l'interface VR.

// En français on écrit « Tu fais quoi ? » avec une espace avant le « ? ».
// On la rend insécable pour que la ponctuation ne parte jamais seule à la ligne.
export function frenchSpaces(text) {
  return String(text ?? '')
    .replace(/ ([?!:;»])/g, ' $1')
    .replace(/« /g, '« ');
}

// 754000 ms -> "12:34"
export function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Ligne « métier » d'une carte : "Graphiste → Développeur" pour une passerelle,
// sinon les métiers ciblés. Chaîne vide s'il n'y a rien à afficher.
export function jobLine(question) {
  if (question.passerelle) {
    const from = question.passerelle.de?.titre ?? question.passerelle.de?.onet ?? '?';
    const to = question.passerelle.vers?.titre ?? question.passerelle.vers?.onet ?? '?';
    return `${from} → ${to}`;
  }
  return question.metiers.map((job) => job.titre ?? job.onet).join(', ');
}
