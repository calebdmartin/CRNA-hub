// CRNA Hub — Web Push sending (RFC 8291 payload encryption + RFC 8292
// VAPID), Nov 11, 2026. Written on WebCrypto only, so the exact code
// that runs in the Edge Function is harness-tested in node with a
// mocked push service. Keys come from the function's environment —
// never hardcoded:
//
//   VAPID_PUBLIC_KEY   base64url, 65-byte uncompressed P-256 point
//   VAPID_PRIVATE_KEY  base64url, 32-byte P-256 private scalar
//   VAPID_SUBJECT      e.g. "mailto:hello@example.com"
//
// Generate a key pair once (any Web Push admin tool, or:
//   node -e "const{generateKeyPairSync}=require('crypto');
//     const{publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
//     console.log(publicKey.export({type:'pkcs8',format:'jwk'}))"
// — or the `web-push` npm CLI: `web-push generate-vapid-keys`.)

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function b64urlToBytes(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 === 0 ? "" : "=".repeat(4 - (t.length % 4));
  const str = t + pad;
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of str) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

export function bytesToB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2];
    s += B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    if (b !== undefined) s += B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    if (c !== undefined) s += B64[c & 63];
  }
  return s.replace(/\+/g, "-").replace(/\//g, "_");
}

function utf8(s) { return new TextEncoder().encode(s); }

async function vapidSigningKey(publicKeyB64, privateKeyB64) {
  const pub = b64urlToBytes(publicKeyB64);
  if (pub.length !== 65 || pub[0] !== 4) {
    throw new Error("vapid_public_key_invalid");
  }
  const jwk = {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(b64urlToBytes(privateKeyB64)),
  };
  return await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
}

export async function vapidAuthHeader(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = bytesToB64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64url(utf8(JSON.stringify({
    aud, exp, sub: vapid.subject,
  })));
  const signingInput = header + "." + payload;
  const key = await vapidSigningKey(vapid.publicKey, vapid.privateKey);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput),
  );
  const jwt = signingInput + "." + bytesToB64url(new Uint8Array(sig));
  return "vapid t=" + jwt + ", k=" + vapid.publicKey;
}

async function hkdfExpand(ikmBytes, salt, info, length) {
  const key = await crypto.subtle.importKey("raw", ikmBytes, "HKDF", false,
    ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8,
  );
  return new Uint8Array(bits);
}

function concatBytes(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// RFC 8291 §3.3/§3.4 (aes128gcm content coding, single record).
export async function encryptPayload(p256dhB64, authB64, plaintext) {
  const uaPub = b64urlToBytes(p256dhB64);
  const authSecret = b64urlToBytes(authB64);
  const asPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const asPub = new Uint8Array(
    await crypto.subtle.exportKey("raw", asPair.publicKey),
  );
  const uaKey = await crypto.subtle.importKey(
    "raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", namedCurve: "P-256", public: uaKey },
    asPair.privateKey, 256,
  ));
  const ikm = await hkdfExpand(
    shared, authSecret,
    concatBytes(utf8("WebPush: info\0"), uaPub, asPub), 32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdfExpand(ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(ikm, salt, utf8("Content-Encoding: nonce\0"), 12);
  // Single (final) record: payload + 0x02 delimiter, no extra padding.
  const record = concatBytes(utf8(plaintext), new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey(
    "raw", cek, { name: "AES-GCM" }, false, ["encrypt"],
  );
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, record,
  ));
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  header[16] = 0; header[17] = 0; header[18] = 0x10; header[19] = 0; // rs=4096
  header[20] = 65;
  header.set(asPub, 21);
  return concatBytes(header, cipher);
}

// Sends one push message. Returns the push service's HTTP status;
// 404/410 mean the subscription is gone and the caller prunes the row.
export async function sendWebPush(subscription, payloadObj, vapid) {
  const keys = (subscription && subscription.keys) || {};
  const body = await encryptPayload(
    keys.p256dh, keys.auth, JSON.stringify(payloadObj),
  );
  const auth = await vapidAuthHeader(subscription.endpoint, vapid);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
    },
    body,
  });
  try { await res.text(); } catch (_e) { /* body is not needed */ }
  return res.status;
}
