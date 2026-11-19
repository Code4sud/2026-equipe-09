// Compte à rebours de la partie.
// Il mesure le temps avec l'horloge (et non en comptant les ticks) : il reste
// juste même si l'onglet est ralenti ou si un tick saute.

export function createTimer({
  durationMs,
  tickMs = 1000,
  now = () => Date.now(),
  onTick = () => {},
  onEnd = () => {},
}) {
  let elapsedBeforeMs = 0; // temps cumulé avant la dernière reprise
  let startedAt = null; // null = chrono à l'arrêt
  let intervalId = null;
  let ended = false;

  function getElapsedMs() {
    return elapsedBeforeMs + (startedAt === null ? 0 : now() - startedAt);
  }

  function getRemainingMs() {
    return Math.max(0, durationMs - getElapsedMs());
  }

  function stopTicking() {
    clearInterval(intervalId);
    intervalId = null;
  }

  function tick() {
    const remainingMs = getRemainingMs();
    onTick(remainingMs);
    if (remainingMs <= 0 && !ended) {
      ended = true;
      stopTicking();
      onEnd();
    }
  }

  function start() {
    if (startedAt !== null) {
      return;
    }
    startedAt = now();
    if (!ended) {
      intervalId = setInterval(tick, tickMs);
      intervalId?.unref?.(); // Node uniquement : ne retient pas le processus à la fin des tests
      tick();
    }
  }

  function pause() {
    if (startedAt === null) {
      return;
    }
    elapsedBeforeMs = getElapsedMs();
    startedAt = null;
    stopTicking();
  }

  return {
    start,
    pause,
    resume: start,
    stop: pause,
    tick,
    getElapsedMs,
    getRemainingMs,
    isRunning: () => startedAt !== null,
    hasEnded: () => ended,
  };
}
