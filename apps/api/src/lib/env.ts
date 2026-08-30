import 'dotenv/config';

/**
 * Environment configuration, validated once at boot so a misconfigured
 * deployment fails immediately and loudly rather than at the first request.
 */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

const jwtSecret = required('JWT_SECRET', isProduction ? undefined : 'dev-only-insecure-secret');

// A shared default signing key would let anyone mint a valid admin token, so
// production refuses to start on the placeholder value.
if (isProduction && (jwtSecret === 'change-me-in-every-environment' || jwtSecret.length < 32)) {
  throw new Error(
    'JWT_SECRET must be a unique value of at least 32 characters in production.',
  );
}

export const env = {
  isProduction,
  databaseUrl: required('DATABASE_URL', 'file:./dev.db'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  seedPassword: process.env.SEED_PASSWORD ?? 'Password123!',
} as const;
