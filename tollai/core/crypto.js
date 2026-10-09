const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBytes(data) {
  return typeof data === 'string' ? textEncoder.encode(data) : data;
}

function subtle() {
  const webcrypto = globalThis.crypto;
  if (!webcrypto || !webcrypto.subtle) {
    throw new Error('tollai: Web Crypto API (globalThis.crypto.subtle) is required');
  }
  return webcrypto.subtle;
}

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function randomId() {
  return randomHex(16);
}

export async function hmacHex(key, data) {
  const cryptoKey = await subtle().importKey(
    'raw',
    toBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle().sign('HMAC', cryptoKey, toBytes(data));
  return bytesToHex(new Uint8Array(signature));
}

export async function sha256Hex(data) {
  const digest = await subtle().digest('SHA-256', toBytes(data));
  return bytesToHex(new Uint8Array(digest));
}

export function b64urlEncode(input) {
  const bytes = toBytes(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(input) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return textDecoder.decode(bytes);
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bytesA = textEncoder.encode(a);
  const bytesB = textEncoder.encode(b);
  if (bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

export async function signPayload(payload, secret) {
  if (payload === null || typeof payload !== 'object') {
    throw new TypeError('tollai: signPayload expects a plain object payload');
  }
  const encoded = b64urlEncode(JSON.stringify(payload));
  const signature = await hmacHex(secret, encoded);
  return `${encoded}.${signature}`;
}

export async function verifySignature(token, secret) {
  try {
    if (typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot !== token.lastIndexOf('.') || dot === token.length - 1) {
      return null;
    }
    const encoded = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    const expected = await hmacHex(secret, encoded);
    if (!timingSafeEqual(signature, expected)) return null;
    const payload = JSON.parse(b64urlDecode(encoded));
    if (payload === null || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  }
}
