export const defaultGifDomains = ['tenor.com', 'giphy.com', 'gph.is', 'klipy.com'];
export const domainIs = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);
export function approvedGifUrl(url: URL, domains: readonly string[] = defaultGifDomains): boolean {
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
    domains.some(domain => domainIs(url.hostname.toLowerCase().replace(/\.$/, ''), domain));
}
export function gifUrl(url: URL, domains: readonly string[] = defaultGifDomains): boolean {
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* Retain invalid encoded paths. */ }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return approvedGifUrl(url, domains) || /\.gifv?(?:$|\/)/i.test(path) ||
    (['cdn.discordapp.com', 'media.discordapp.net'].some(domain => domainIs(host, domain)) &&
      /^\/attachments\//i.test(path) && /(?:[?&](?:format|fm)=gif)(?:&|$)/i.test(url.search));
}
export function approvedGifSource(value: string, domains: readonly string[] = defaultGifDomains): boolean {
  try { return approvedGifUrl(new URL(value), domains); } catch { return false; }
}
