/**
 * The "server-only" marker for tsx scripts (scripts/tsconfig.server-only.json maps it here). In
 * the Next.js app the real marker makes importing a server-only module from a client component a
 * build error; a script runs on the server anyway, so this is empty.
 */
export {};
