import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBotMarkdown } from '../tools/markdown/render.mjs';
import { fixture, find } from './markdown-renderer-harness.mjs';
import { ordinaryTargets, ambiguousTargets, otherUnicodeTargets, idnOrigins, forms } from './target-integrity-cases.mjs';
const render=(source,ownOrigin='https://artemis.invalid')=>renderBotMarkdown(source,{document:fixture().document,ownOrigin});
for(const ownOrigin of idnOrigins)test('uppercase Unicode source cannot turn current IDN into another host: '+ownOrigin,()=>{
 for(const url of ambiguousTargets.slice(0,2))for(const source of forms(url))assert.equal(find(render(source,ownOrigin),'a').length,0,source);
});
for(const url of ambiguousTargets)test('ambiguous parser normalization fails closed, never substitutes external destination: '+url,()=>{
 for(const source of forms(url)){const root=render(source);assert.equal(find(root,'a').length,0);assert.ok(root.textContent.includes(url));}
});
for(const url of ordinaryTargets)test('supported ordinary IDN/ASCII-uppercase target keeps native intended href: '+url,()=>{
 for(const source of forms(url)){
  const a=find(render(source),'a')[0];assert.ok(a,source);assert.equal(a.href,new URL(url).href);assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');assert.equal(a.referrerPolicy,'no-referrer');
 }
});
for(const url of otherUnicodeTargets)test('additional Unicode spellings either retain native target exactly or stay inert: '+url,()=>{
 for(const source of forms(url))for(const a of find(render(source),'a'))assert.equal(a.href,new URL(url).href);
});
