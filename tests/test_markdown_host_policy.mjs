import test from 'node:test';
import assert from 'node:assert/strict';
import { safeMarkdownURL, renderBotMarkdown } from '../tools/markdown/render.mjs';
import { fixture, find } from './markdown-renderer-harness.mjs';
import { ownOrigins, ownDestinations, ambiguousExternal, validExternal, spellings } from './host-policy-cases.mjs';
for(const ownOrigin of ownOrigins) test('host identity rejects every own-host alias in both directions: '+ownOrigin,()=>{
 const {document}=fixture();
 for(const url of ownDestinations){
  assert.equal(safeMarkdownURL(url,ownOrigin),null,url);
  for(const source of spellings(url))assert.equal(find(renderBotMarkdown(source,{document,ownOrigin}),'a').length,0,source);
 }
});
for(const url of ambiguousExternal) test('ambiguous trailing-dot external destinations fail closed: '+url,()=>{
 const {document}=fixture();assert.equal(safeMarkdownURL(url,ownOrigins[0]),null);
 for(const source of spellings(url))assert.equal(find(renderBotMarkdown(source,{document,ownOrigin:ownOrigins[0]}),'a').length,0);
});
for(const ownOrigin of ownOrigins) test('valid external links stay usable from ordinary or dotted origin: '+ownOrigin,()=>{
 const {document}=fixture();
 for(const url of validExternal){
  assert.equal(safeMarkdownURL(url,ownOrigin),new URL(url).href);
  for(const source of spellings(url)){
   const a=find(renderBotMarkdown(source,{document,ownOrigin}),'a')[0];assert.ok(a);
   assert.equal(a.href,new URL(url).href);assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener noreferrer');assert.equal(a.referrerPolicy,'no-referrer');
  }
 }
});
