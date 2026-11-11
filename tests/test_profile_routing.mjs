// Explicit synthetic contracts only: no socket, filesystem profile or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProfile, verifyBinding, targetFor } from '../dashboard/assets/routing.mjs';
import { canonicalRequest } from '../dashboard/assets/canonical.mjs';
const names = ['default','inara','kaylee','simon','wash','zoey'];
function roster(profile='wash', host='host-a', canonical=true) {
  return {install_id:host,bot_mode_protocol:true,profiles:[profile,...names.filter(n=>n!==profile)].map(name=>({name,path:`/synthetic/${host}/${name}`,display_name:name==='wash'?'Wash':'Same name',...(canonical?{canonical_session:{id:`canonical-${host}-${name}`,resolved_id:`canonical-${host}-${name}`}}:{canonical_session:null})}))};
}
test('profile selection is explicit, literal and unambiguous',()=>{
 for(const name of names) assert.equal(parseProfile(`https://a.invalid/ui?profile=${name}`),name);
 for(const name of names) assert.equal(parseProfile(`https://a.invalid/ui?artemis_profile=${name}`),name);
 assert.throws(()=>parseProfile('https://a.invalid/ui?profile=wash&artemis_profile=default'));
 assert.throws(()=>parseProfile('https://a.invalid/ui?artemis_profile=wash&artemis_profile=wash'));
 assert.equal(parseProfile('https://a.invalid/ui'),null);
 for(const tail of ['?profile=','?profile=Wash','?profile=../wash','?profile=wash&profile=wash','?profile=wash&profile=default']) assert.throws(()=>parseProfile('https://a.invalid/ui'+tail));
 assert.throws(()=>parseProfile('https://a.invalid/p/wash/api/plugins/x/ui?profile=default'));
});
test('six bound profiles use stable canonical metadata, not names, previews or recency',async()=>{
 for(const name of names){
  const r=roster(name); const binding=verifyBinding({profile:name,origin:'https://a.invalid',description:{profile_id:`/synthetic/host-a/${name}`,instance_id:'generation'},roster:r});
  const target=await targetFor(binding,r);
  assert.equal(target.sessionId,`canonical-host-a-${name}`); assert.equal(target.kind,'canonical');
  assert.equal(Object.hasOwn(target,'createParams'),false);
 }
});
test('missing/deleted/unknown/wrong-ticket/profile mismatch fails closed',()=>{
 const r=roster(); const args={profile:'wash',origin:'https://a.invalid',description:{profile_id:'/synthetic/host-a/wash',instance_id:'generation'},roster:r};
 for(const bad of [null,'unknown','deleted']) assert.throws(()=>verifyBinding({...args,profile:bad}));
 assert.throws(()=>verifyBinding({...args,description:{profile_id:'/synthetic/host-a/default',instance_id:'generation'}}));
 assert.throws(()=>verifyBinding({...args,roster:roster('default')}));
 assert.throws(()=>verifyBinding({...args,expectedHost:'another-host'}));
 assert.throws(()=>verifyBinding({...args,roster:{...r,profiles:[...r.profiles,r.profiles[0]]}}));
});
test('missing metadata stays canonical-only; separate explicit canonical request namespace is scope stable',async()=>{
 const results=[];
 for(const origin of ['https://a.invalid','https://b.invalid']) for(const host of ['host-a','host-b']) for(const profile of names){
  const r=roster(profile,host,false); const b=verifyBinding({profile,origin,description:{profile_id:`/synthetic/${host}/${profile}`,instance_id:'generation'},roster:r});
  const a=await targetFor(b,r); const again=await targetFor(b,r);
  assert.equal(a.kind,'canonical'); assert.equal(a.sessionId,null); assert.deepEqual(a,again); assert.equal(Object.hasOwn(a,'createParams'),false); const request=await canonicalRequest(b); assert.match(request.request_id,/^artemis-canonical-bot-chat-v1-/); results.push(request.request_id);
 }
 assert.equal(new Set(results).size,results.length);
});
