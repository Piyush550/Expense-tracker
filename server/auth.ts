// Verifies Firebase ID tokens without the Admin SDK: they are RS256 JWTs signed with
// Google's published keys. See https://firebase.google.com/docs/auth/admin/verify-id-tokens
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import { unauthorized } from "./errors";

export interface AuthClaims {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export type VerifyToken = (token: string) => Promise<AuthClaims>;

const GOOGLE_KEYS = new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");

function toClaims(payload: JWTPayload): AuthClaims {
  const sub = payload.sub;
  if (typeof sub !== "string" || !sub || sub.length > 128) throw unauthorized();
  const authTime = payload["auth_time"];
  if (typeof authTime !== "number" || authTime > Date.now() / 1000 + 60) throw unauthorized();
  const email = typeof payload["email"] === "string" ? payload["email"].toLowerCase() : null;
  const name = typeof payload["name"] === "string" ? payload["name"] : null;
  return { uid: sub, email, emailVerified: payload["email_verified"] === true, name };
}

export function firebaseVerifier(projectId: string): VerifyToken {
  // Keys are fetched once and cached for the life of the function instance.
  const keys = createRemoteJWKSet(GOOGLE_KEYS);
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        algorithms: ["RS256"],
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        clockTolerance: 30,
      });
      return toClaims(payload);
    } catch (err) {
      if (err instanceof Error && err.name === "HttpError") throw err;
      throw unauthorized();
    }
  };
}

/**
 * The Firebase Auth emulator issues unsigned tokens. Only scripts/local-api.ts uses this;
 * the deployed function always uses firebaseVerifier.
 */
export function emulatorVerifier(projectId: string): VerifyToken {
  return async (token) => {
    let payload: JWTPayload;
    try {
      payload = decodeJwt(token);
    } catch {
      throw unauthorized();
    }
    if (payload.iss !== `https://securetoken.google.com/${projectId}` || payload.aud !== projectId) throw unauthorized();
    return toClaims(payload);
  };
}
