import { jwtVerify, createRemoteJWKSet } from "jose";

export interface AccessIdentity {
  email: string;
}

// createRemoteJWKSet caches the fetched JWKS internally and should be created
// once per team domain, not per request — recreating it on every call would
// re-fetch the certs endpoint on every admin request. Keyed by team domain
// since that's a stable per-deployment config value, not per-request state.
const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeamDomain.set(teamDomain, jwks);
  }
  return jwks;
}

export async function verifyAccessRequest(
  request: Request,
  env: Env,
): Promise<AccessIdentity | null> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  try {
    const jwks = getJwks(env.ACCESS_TEAM_DOMAIN);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
    });
    if (typeof payload.email !== "string") return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}
