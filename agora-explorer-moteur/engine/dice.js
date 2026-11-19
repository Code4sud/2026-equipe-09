// Le dé. `random` est injectable pour rendre les tests reproductibles.

export function rollDie(faces = 6, random = Math.random) {
  const value = Math.floor(random() * faces) + 1;
  return Math.min(faces, Math.max(1, value));
}

export function isValidRoll(value, faces = 6) {
  return Number.isInteger(value) && value >= 1 && value <= faces;
}
