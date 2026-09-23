import {
  DEFAULT_SITE_URL,
  SITE_NAME,
  resolveRouteSeo,
} from '@defcon/shared';

function getSiteUrl(): string {
  const raw = import.meta.env.VITE_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  return raw.replace(/\/+$/, '');
}

function upsertMetaByName(name: string, content: string) {
  let node = document.head.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute('name', name);
    document.head.appendChild(node);
  }
  node.setAttribute('content', content);
}

function upsertMetaByProperty(property: string, content: string) {
  let node = document.head.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute('property', property);
    document.head.appendChild(node);
  }
  node.setAttribute('content', content);
}

function upsertCanonical(href: string) {
  let node = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!node) {
    node = document.createElement('link');
    node.setAttribute('rel', 'canonical');
    document.head.appendChild(node);
  }
  node.setAttribute('href', href);
}

export function applyRouteSeo(pathname: string) {
  const siteUrl = getSiteUrl();
  const routeSeo = resolveRouteSeo(pathname);
  const canonical = `${siteUrl}${routeSeo.canonicalPath}`;
  const fullTitle = routeSeo.title.includes('DefTrack') ? routeSeo.title : `${routeSeo.title} | DefTrack`;

  document.title = fullTitle;
  upsertCanonical(canonical);

  upsertMetaByName('description', routeSeo.description);
  upsertMetaByName('keywords', routeSeo.keywords);
  const robotsValue = routeSeo.robots;
  upsertMetaByName('robots', robotsValue);
  upsertMetaByName('googlebot', robotsValue);

  upsertMetaByProperty('og:type', 'website');
  upsertMetaByProperty('og:site_name', SITE_NAME);
  upsertMetaByProperty('og:title', fullTitle);
  upsertMetaByProperty('og:description', routeSeo.description);
  upsertMetaByProperty('og:url', canonical);
  upsertMetaByProperty('og:image', `${siteUrl}/defcon.png`);
  upsertMetaByProperty('og:image:alt', 'DefTrack DeFCoN Explorer logo');
  upsertMetaByProperty('og:locale', 'en_US');

  upsertMetaByName('twitter:card', 'summary_large_image');
  upsertMetaByName('twitter:title', fullTitle);
  upsertMetaByName('twitter:description', routeSeo.description);
  upsertMetaByName('twitter:image', `${siteUrl}/defcon.png`);
  upsertMetaByName('twitter:image:alt', 'DefTrack DeFCoN Explorer logo');
}
