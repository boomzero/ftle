import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";
import { verifyAccessRequest } from "../../src/auth/access";

const TEAM_DOMAIN = "https://test-team.cloudflareaccess.com";
const AUD = "test-aud-tag";

let publicJwk: Record<string, unknown>;
let privateKey: KeyLike;
const kid = "test-key-1";

beforeAll(async () => {
  const { publicKey, privateKey: priv } = await generateKeyPair("RS256");
  privateKey = priv;
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = "RS256";
  jwk.use = "sig";
  publicJwk = jwk as unknown as Record<string, unknown>;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockCertsEndpoint() {
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return original(input, init);
  });
}

async function makeToken(overrides: Partial<{ aud: string; exp: number; email: string }> = {}) {
  return new SignJWT({ email: overrides.email ?? "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt()
    .setIssuer(TEAM_DOMAIN)
    .setAudience(overrides.aud ?? AUD)
    .setExpirationTime(overrides.exp ?? Math.floor(Date.now() / 1000) + 3600)
    .sign(privateKey);
}

const env = { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD } as unknown as Env;

describe("verifyAccessRequest", () => {
  it("returns the identity for a valid token", async () => {
    mockCertsEndpoint();
    const token = await makeToken();
    const req = new Request("https://worker.example/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const identity = await verifyAccessRequest(req, env);
    expect(identity).toEqual({ email: "owner@example.com" });
  });

  it("returns null when the header is missing", async () => {
    const req = new Request("https://worker.example/admin");
    expect(await verifyAccessRequest(req, env)).toBeNull();
  });

  it("returns null for a token with the wrong audience", async () => {
    mockCertsEndpoint();
    const token = await makeToken({ aud: "wrong-aud" });
    const req = new Request("https://worker.example/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(await verifyAccessRequest(req, env)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    mockCertsEndpoint();
    const token = await makeToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    const req = new Request("https://worker.example/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect(await verifyAccessRequest(req, env)).toBeNull();
  });
});
