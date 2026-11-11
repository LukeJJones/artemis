export const rejectedAngleTargets = [
 'https://B&#220;CHER.INVALID/A?x=1&amp;y=2#z',
 'https://B&#xDC;CHER.INVALID/A',
 'https://outside.invalid/a&#10;b',
 'https://outside.invalid/&#x200b;',
 'https://outside.invalid/a&NewLine;b',
];
export const destinationForms = raw => ['[visible](<'+raw+'>)','[visible][ref]\n\n[ref]: <'+raw+'>'];
export const positiveEntityTarget = 'https://outside.invalid/path?x=1&amp;y=2#frag';
export const positiveDecodedTarget = 'https://outside.invalid/path?x=1&y=2#frag';
export const rawAutolinkControl = 'https://outside.invalid/a&#10;b';
