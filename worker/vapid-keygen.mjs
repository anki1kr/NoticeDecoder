// One-time VAPID key pair for Web Push. The PRIVATE key goes to stdout only, to be piped straight into
// `npx wrangler secret put VAPID_PRIVATE_JWK` (never into a file); the PUBLIC key is printed on stderr for wrangler.toml.
//   node vapid-keygen.mjs | npx wrangler secret put VAPID_PRIVATE_JWK
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', k.publicKey)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const priv = await crypto.subtle.exportKey('jwk', k.privateKey);
process.stderr.write(`VAPID_PUBLIC = "${pub}"\n`);
process.stdout.write(JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d }));
