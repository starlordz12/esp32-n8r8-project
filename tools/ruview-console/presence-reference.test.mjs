import test from 'node:test';
import assert from 'node:assert/strict';
import {presenceWindows,fitPresenceReference,classifyPresence,evaluatePresence} from './presence-reference.mjs';
const capture=(label,offset=0)=>({label,frames:Array.from({length:600},(_,i)=>({timestamp:100+i*.05,
  nodes:[1,2].map(node_id=>({node_id,subcarrier_count:128,amplitude:[0,0,...Array.from({length:54},(_,k)=>10+(k%(label==='empty'?4:7))+.01*Math.sin(i+k+node_id)+offset*(k%3))]})),
  node_features:[1,2].map(node_id=>({node_id,stale:false,last_seen_ms:0}))}))});
test('paired stationary comparison preserves experimental status even on separable data',()=>{
  const empty=capture('empty'),seated=capture('stationary'),model=fitPresenceReference(empty,seated,[1,2]);
  assert.equal(model.validated,false);
  const {results,...report}=evaluatePresence(model,empty,'absent');
  assert.equal(report.wrong,0);assert.ok(report.matched>=10);
  assert.ok(results.every(r=>r.validated===false&&r.status==='experimental'));
  assert.equal(classifyPresence(model,{nodes:[]}).status,'unavailable');
  const window=presenceWindows(seated,[1,2]).windows[0];window.nodes[0].subcarrier_count=64;
  assert.equal(classifyPresence(model,window).reason,'missing_or_changed_radio');
});
test('missing or stale second radio cannot become complete occupancy evidence',()=>{
  const c=capture('empty');for(const f of c.frames)f.node_features[1].stale=true;
  assert.throws(()=>presenceWindows(c,[1,2]),/Insufficient/);
  assert.throws(()=>fitPresenceReference(capture('empty'),capture('empty'),[1,2]),/Known empty and seated/);
});
test('presence comparison abstains when channel shapes fall outside both references',()=>{
  const model=fitPresenceReference(capture('empty'),capture('stationary'),[1,2]);
  const w=presenceWindows(capture('stationary',10),[1,2]).windows[0];
  assert.equal(classifyPresence(model,w).reason,'outside_reference_shapes');
});
