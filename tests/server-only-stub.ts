/**
 * Stands in for the `server-only` guard while testing.
 *
 * Next.js resolves that package to an empty module on the server and to a
 * build error in a client bundle; outside Next it does not resolve at all. The
 * guard is worth keeping in the source — it is what stops a credentialed
 * module being imported into the browser — so the test runner is pointed here
 * instead of the import being removed.
 */
export {}
