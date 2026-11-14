// The contract's version, without zod, so a client can stamp its events without bundling the schemas.
//
// Every event carries the version it was written to (`v`, 1 when absent). Within a version the contract only grows:
// new optional fields, new event kinds, new values in the open lists. Renaming, removing, retyping or requiring a field
// is a new version. docs/architecture.md ("How the contract changes") has the whole rule set.
export const CONTRACT_VERSION = 1;

// The oldest version the API still accepts. Raising it is a deliberate step: the API keeps an upgrader for every version
// from here up, and answers an older client 426 upgrade_required, which the client treats as "keep the events, wait".
export const MIN_CONTRACT_VERSION = 1;
