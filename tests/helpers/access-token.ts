import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { vi } from "vitest";

export const TEST_TEAM_DOMAIN = "https://test-team.cloudflareaccess.com";
export const TEST_AUD = "test-aud-tag";
const kid = "test-key-1";

let cachedPrivateKey: CryptoKey | undefined;
let cachedPublicJwk: JsonWebKey | undefined;

async function getKeys() {
  if (!cachedPrivateKey || !cachedPublicJwk) {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    cachedPrivateKey = privateKey;
    cachedPublicJwk = await exportJWK(publicKey);
    cachedPublicJwk.kid = kid;
    cachedPublicJwk.alg = "RS256";
    cachedPublicJwk.use = "sig";
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
