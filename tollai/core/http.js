const BROWSER_UA = /Mozilla|Chrome|Safari|Firefox|Edg|OPR\//i;

export function headerGet(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(raw);
    } catch {
      cookies[key] = raw;
    }
  }
  return cookies;
}

export function buildCookie(name, value, options = {}) {
  const {
    path = '/',
    maxAge,
    httpOnly = true,
    sameSite = 'Lax',
    secure = false,
    expires,
  } = options;
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (path) cookie += `; Path=${path}`;
  if (maxAge !== undefined) cookie += `; Max-Age=${Math.floor(maxAge)}`;
  if (expires !== undefined) cookie += `; Expires=${new Date(expires).toUTCString()}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (sameSite) cookie += `; SameSite=${sameSite}`;
  if (secure) cookie += '; Secure';
  return cookie;
}

export function sessionCookie(token, { ttlMs, secure = false, cookieName = 'tollai_session' } = {}) {
  return buildCookie(cookieName, token, { maxAge: Math.floor(ttlMs / 1000), secure });
}

export function json(data, { status = 200, headers = {} } = {}) {
  const finalHeaders = { 'content-type': 'application/json; charset=utf-8', ...headers };
  return new Response(JSON.stringify(data), { status, headers: finalHeaders });
}

export function html(body, { status = 200, headers = {} } = {}) {
  const finalHeaders = { 'content-type': 'text/html; charset=utf-8', ...headers };
  return new Response(body, { status, headers: finalHeaders });
}

export function wantsHtml(headers) {
  const accept = headerGet(headers, 'accept') || '';
  return /\btext\/html\b/.test(accept) && !/\bapplication\/json\b/.test(accept);
}

export function looksLikeBrowser(headers) {
  const signals = {
    ua: BROWSER_UA.test(headerGet(headers, 'user-agent') || ''),
    acceptLanguage: /\S/.test(headerGet(headers, 'accept-language') || ''),
    secFetch: !!(
      headerGet(headers, 'sec-fetch-mode') ||
      headerGet(headers, 'sec-fetch-site') ||
      headerGet(headers, 'sec-fetch-dest')
    ),
    secChUa: !!headerGet(headers, 'sec-ch-ua'),
    acceptHtml: /\btext\/html\b/.test(headerGet(headers, 'accept') || ''),
  };
  const score = Object.values(signals).filter(Boolean).length;
  return signals.ua && score >= 3;
}

export function getClientIp(headers) {
  const forwarded = headerGet(headers, 'x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  const connectingIp = headerGet(headers, 'cf-connecting-ip');
  if (connectingIp) return String(connectingIp).trim();
  const realIp = headerGet(headers, 'x-real-ip');
  if (realIp) return String(realIp).trim();
  return null;
}
