export function isInGame(): boolean {
  const p = location.pathname;
  return (
    p.startsWith("/game/") ||
    p.startsWith("/challenge/") ||
    p.startsWith("/duels/") ||
    p.startsWith("/team-duels/") ||
    p.startsWith("/battle-royale/") ||
    p.startsWith("/live-challenge/")
  );
}

export function watchRoutes(onRoute: () => void): void {
  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function () {
    origPush.apply(this, arguments as any);
    onRoute();
  };

  history.replaceState = function () {
    origReplace.apply(this, arguments as any);
    onRoute();
  };

  window.addEventListener("popstate", onRoute);
  setInterval(onRoute, 500);
  onRoute();
}
