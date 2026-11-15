import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface AuthConfig {
  jwksUrl: string;
  issuer?: string;
  authorizedParties?: string[];
  devMode?: boolean;
}

export interface AuthenticatedUser { id: string; claims: JWTPayload }

export function createTokenVerifier(config: AuthConfig): (token: string) => Promise<AuthenticatedUser> {
  if (config.devMode) {
    return async (token) => {
      const id = token.trim();
      if (!id || id.length > 128) throw new Error('invalid token');
      return { id, claims: { sub: id } };
    };
  }
  if (!config.issuer) throw new Error('REALTIME_JWT_ISSUER must be configured outside development mode');
  const authorizedParties = config.authorizedParties ?? [];
  if (authorizedParties.length === 0) throw new Error('REALTIME_JWT_AUTHORIZED_PARTIES must include an allowed origin');
  const keys = createRemoteJWKSet(new URL(config.jwksUrl));
  return async (token) => {
    const result = await jwtVerify(token, keys, { issuer: config.issuer, algorithms: ['RS256'] });
    const id = result.payload.sub;
    if (!id || typeof result.payload.exp !== 'number') throw new Error('token must include subject and expiration');
    if (typeof result.payload.azp !== 'string' || !authorizedParties.includes(result.payload.azp)) {
      throw new Error('unauthorized party');
    }
    return { id, claims: result.payload };
  };
}
