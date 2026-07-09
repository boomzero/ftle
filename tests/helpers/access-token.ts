import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";
import { vi } from "vitest";

export const TEST_TEAM_DOMAIN = "https://test-team.cloudflareaccess.com";
export const TEST_AUD = "test-aud-tag";
const kid = "test-key-1";

let cachedPrivateKey: KeyLike | undefined;
let cachedPublicJwk: Record<string, unknown> | undefined;

async function getKeys() {
  if (!cachedPrivateKey || !cachedPublicJwk) {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    cachedPrivateKey = privateKey;
    const jwk = await exportJWK(publicKey);
    jwk.kid = kid;
    jwk.alg = "RS256";
    jwk.use = "sig";
    cachedPublicJwk = jwk as unknown as Record<string, unknown>;
  }
  return { privateKey: cachedPrivateKey, publicJwk: cachedPublicJwk };
}

export async function mockAccessCerts() {
  const { publicJwk } = await getKeys();
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return original(input, init);
  });
}

export async function makeAccessToken(email = "owner@example.com"): Promise<string> {
  const { privateKey } = await getKeys();
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setIssuer(TEST_TEAM_DOMAIN)
    .setAudience(TEST_AUD)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);
}

export async function authedHeaders(): Promise<Record<string, string>> {
  await mockAccessCerts();
  const token = await makeAccessToken();
  return { "Cf-Access-Jwt-Assertion": token };
}
