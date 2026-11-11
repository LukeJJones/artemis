import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBotMarkdown } from '../tools/markdown/render.mjs';
import { fixture, find } from './markdown-renderer-harness.mjs';
import { rejectedAngleTargets, destinationForms, positiveEntityTarget, positiveDecodedTarget, rawAutolinkControl } from './rejected-fallback-cases.mjs';
const render=source=>renderBotMarkdown(source,{document:fixture().document,ownOrigin:'https://artemis.invalid'});
for(const raw of rejectedAngleTargets)for(const [i,source] of destinationForms(raw).entries())test('rejected angle destination cannot revive as raw autolink '+i+' '+raw,()=>{
 const root=render(source);assert.equal(find(root,'a').length,0);assert.ok(root.textContent.trim());assert.equal(render(source).textContent,root.textContent);
});
for(const [i,source] of destinationForms(positiveEntityTarget).entries())test('valid entity-decoded destination remains supported '+i,()=>{
 const a=find(render(source),'a');assert.equal(a.length,1);assert.equal(a[0].href,new URL(positiveDecodedTarget).href);
});
for(const raw of [positiveEntityTarget,rawAutolinkControl])test('standalone raw entity-bearing autolink remains a legitimate raw target '+raw,()=>{
 const a=find(render('<'+raw+'>'),'a');assert.equal(a.length,1);assert.equal(a[0].href,new URL(raw).href);
});
for(const form of destinationForms(rawAutolinkControl))test('same-target fallback quarantine is order-independent '+form.split('\n')[0],()=>{
 for(const source of ['<'+rawAutolinkControl+'>\n\n'+form,form+'\n\n<'+rawAutolinkControl+'>']){
  const a=find(render(source+'\n\n[good](https://different.invalid/ok)'),'a');assert.equal(a.length,1);assert.equal(a[0].href,'https://different.invalid/ok');
 }
});
for(const fenced of [false,true])test('code is exact and cannot poison legitimate raw autolinks '+fenced,()=>{
 const literal=destinationForms(rawAutolinkControl)[0];const source=(fenced?'```txt\n'+literal+'\n```':'`'+literal+'`')+'\n\n<'+rawAutolinkControl+'>';
 const root=render(source);assert.equal(find(root,'code')[0].textContent,literal+(fenced?'\n':''));assert.equal(find(root,'a').length,1);
});
test('rejection context never leaks into subsequent message renders',()=>{
 for(const source of destinationForms(rawAutolinkControl)){assert.equal(find(render(source),'a').length,0);assert.equal(find(render('<'+rawAutolinkControl+'>'),'a').length,1);}
});
test('token-budget plain fallback does not retain rejection context',()=>{
 const source=destinationForms(rawAutolinkControl)[0]+'\n\n'+'*x* '.repeat(4000);const root=render(source);assert.equal(root.textContent,source);assert.equal(find(render('<'+rawAutolinkControl+'>'),'a').length,1);
});
