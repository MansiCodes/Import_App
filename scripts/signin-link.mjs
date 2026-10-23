#!/usr/bin/env node
/**
 * Magic-link sign-in has been removed.
 *
 * Login is email and password. A reset link is emailed only from Forgot
 * password, and only through the application's own SMTP settings.
 */

console.error('Magic-link sign-in has been removed.')
console.error('Log in with email and password.')
console.error('Seed the first admin with:  npm run auth:seed')
console.error('Send a reset from the login page once AUTH_SMTP_* is set.')
process.exit(1)
