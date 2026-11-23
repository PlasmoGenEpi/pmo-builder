/**
 * Maps a route path to its page identity for keying `<ErrorBoundary>` and
 * `<ScrollReset>`. Tab switches within My PMO file (`/pmo/:tab`, except
 * `/pmo/open-built`) and within a published view (`/published/:id/:tab`) share
 * one page identity so `<Tabs>` stays mounted and keeps keyboard focus.
 */
export function pageIdentity(location: string): string {
  const pmoTab = /^\/pmo\/([^/]+)$/.exec(location);
  if (pmoTab !== null && pmoTab[1] !== undefined && pmoTab[1] !== "open-built") {
    return "/pmo";
  }
  const publishedTab = /^\/published\/([^/]+)\/[^/]+$/.exec(location);
  if (publishedTab !== null && publishedTab[1] !== undefined) {
    return `/published/${publishedTab[1]}`;
  }
  return location;
}
