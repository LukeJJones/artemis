// Synthetic host spellings; shared test data, not runtime configuration.
export const ownOrigins = [
 'https://artemis.invalid', 'https://ARTEMIS.INVALID', 'https://artemis.invalid.',
 'https://ARTEMIS.INVALID.:9443', 'https://artemis%2einvalid.', 'https://artemis.invalid%2E',
 'https://artemis\u3002invalid\u3002', 'https://artemis.invalid..',
];
export const ownDestinations = [
 'https://artemis.invalid/api/admin', 'https://ARTEMIS.INVALID/auth/logout',
 'https://artemis.invalid:9443/api/admin', 'https://artemis%2einvalid/api/admin',
 'https://artemis.invalid./api/admin', 'https://ARTEMIS.INVALID./auth/logout',
 'https://artemis%2einvalid./api/admin', 'https://artemis.invalid%2e/api/admin',
 'https://artemis.invalid%2E:9443/api/admin', 'https://artemis\u3002invalid\u3002/api/admin',
 'https://artemis.invalid\uff0e/api/admin', 'https://artemis.invalid\uff61/api/admin',
 'https://artemis.invalid../api/admin',
];
export const ambiguousExternal = ['https://external.invalid./guide','https://EXTERNAL.INVALID./guide','https://external.invalid%2e/guide','https://external.invalid\u3002/guide'];
export const validExternal = ['https://external.invalid/guide','HTTPS://EXTERNAL.INVALID/a%20b?q=1&x=2','https://external%2einvalid/guide'];
export const spellings = url => ['[x](<' + url + '>)', '[x][r]\n\n[r]: <' + url + '>', '<' + url + '>'];
