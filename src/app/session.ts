export async function hasAuthenticatedSession(): Promise<boolean> {
  try {
    const res = await fetch("https://www.geoguessr.com/api/v4/feed/private", { credentials: "include" });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}
