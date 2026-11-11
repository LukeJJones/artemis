import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../dashboard/assets/appearance.js',import.meta.url),'utf8');
function fixture({saved={},dark=false,blocked=false}={}){
  const values=new Map(Object.entries(saved)),writes=[],style=new Map(),media={matches:dark,addEventListener(_type,fn){this.change=fn;}};
  const root={dataset:{},style:{setProperty:(key,value)=>style.set(key,value)}};
  const window={};
  vm.runInNewContext(source,{window,document:{documentElement:root},matchMedia:()=>media,localStorage:{getItem(key){if(blocked)throw new Error('Storage denied');return values.get(key)||null;},setItem(key,value){if(blocked)throw new Error('Storage denied');writes.push([key,value]);values.set(key,value);}}});
  return{api:window.artemisAppearance,root,media,values,writes,style};
}
for(const dark of [false,true]) test(`prepaint initial theme follows OS ${dark?'dark':'light'}, keeps Lime default and writes nothing`,()=>{
  const f=fixture({dark}); assert.equal(f.root.dataset.theme,dark?'dark':'light');assert.equal(f.root.dataset.accent,'lime');assert.equal(f.writes.length,0);
});
test('existing accent enum migrates intact and manual theme beats OS before CSS',()=>{
  const f=fixture({dark:true,saved:{'artemis.accent.v1':'purple','artemis.theme.v1':'light'}});
  assert.equal(f.root.dataset.accent,'purple');assert.equal(f.root.dataset.theme,'light');assert.equal(f.writes.length,0);
  f.media.matches=false;f.media.change();f.media.matches=true;f.media.change();assert.equal(f.root.dataset.theme,'light');
  f.api.setTheme('dark');assert.deepEqual(f.writes,[['artemis.theme.v1','dark']]);assert.equal(f.root.dataset.accent,'purple');
});
test('unoverridden OS changes track, manual choice stops tracking and persists only UI enum keys',()=>{
  const f=fixture(); f.media.matches=true;f.media.change();assert.equal(f.root.dataset.theme,'dark');
  f.api.setTheme('light');f.api.setAccent('cyan');f.media.change();assert.equal(f.root.dataset.theme,'light');
  assert.deepEqual(f.writes,[['artemis.theme.v1','light'],['artemis.accent.v1','cyan']]);
  f.api.setTheme('script');f.api.setAccent('__proto__');assert.equal(f.writes.length,2);
});
test('invalid storage values fall back safely; blocked storage retains this-page choices',()=>{
  const bad=fixture({saved:{'artemis.theme.v1':'url(secret)','artemis.accent.v1':'unknown'}});assert.equal(bad.root.dataset.theme,'light');assert.equal(bad.root.dataset.accent,'lime');
  const f=fixture({blocked:true});f.api.setTheme('dark');f.api.setAccent('neutral');assert.equal(f.root.dataset.theme,'dark');assert.equal(f.root.dataset.accent,'neutral');assert.equal(f.api.snapshot().storageAvailable,false);
});
const luminance=hex=>{const a=hex.match(/[\da-f]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('all ten retained accents have >=4.5 text contrast in both full-app themes',()=>{
  const f=fixture();assert.equal(Object.keys(f.api.ACCENTS).length,10);
  for(const theme of ['light','dark'])for(const accent of Object.keys(f.api.ACCENTS)){
    f.api.setTheme(theme);f.api.setAccent(accent);
    assert.ok(contrast(f.style.get('--accent-solid'),f.style.get('--accent-on'))>=4.5,`${theme}/${accent} solid`);
    assert.ok(contrast(f.style.get('--accent-ink'),f.style.get('--accent-ink-on'))>=4.5,`${theme}/${accent} pressed`);
    assert.ok(contrast(f.style.get('--accent-ink'),f.style.get('--accent-soft'))>=4.5,`${theme}/${accent} label`);
  }
});
