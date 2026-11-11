export const ordinaryTargets = [
 'https://bücher.example/guide?q=1#x',
 'https://Bücher.EXAMPLE:9443/caf%C3%A9',
 'HTTPS://EXTERNAL.INVALID:443/guide?q=1#x',
 'https://xn--bcher-kva.example/guide',
 'https://münchen.example/path',
 'https://faß.example/path',
 'https://例え.example/道?q=値#片',
 'https://Example.invalid/a/../b?q=%41#x',
];
export const ambiguousTargets = [
 'https://BÜCHER.INVALID/api/admin?op=logout',
 'https://BÜCHER.INVALID:9443/api/admin?op=logout',
 'https://BÜCHER.EXAMPLE/guide',
];
export const otherUnicodeTargets = [
 'https://İSTANBUL.example/guide', 'https://ΣΌΛΟΣ.example/path',
 'https://ＢＯＯＫ.example/path', 'https://B%C3%9CCHER.example/guide',
];
export const idnOrigins = ['https://bücher.invalid:8443','https://xn--bcher-kva.invalid:8443','https://BÜCHER.INVALID:8443','https://b%C3%BCcher.invalid:8443','https://bücher.invalid.:8443'];
export const forms = url => ['[x](<'+url+'>)','[x][r]\n\n[r]: <'+url+'>','<'+url+'>'];
