import test from 'node:test';
import assert from 'node:assert/strict';
import {allowsUpstreamWrite} from './request-policy.mjs';
test('unrelated model mutations are denied without contacting an upstream service',()=>{
  const origin='http://127.0.0.1:8092';
  for(const path of ['/api/v1/models/load','/api/v1/models/train','/api/v1/models/delete'])
    assert.equal(allowsUpstreamWrite('POST',path,origin,origin),false);
  assert.equal(allowsUpstreamWrite('POST','/api/v1/calibration/start',origin,origin),true);
  assert.equal(allowsUpstreamWrite('POST','/api/v1/calibration/start','https://example.com',origin),false);
  assert.equal(allowsUpstreamWrite('POST','/api/v1/calibration/start',undefined,origin),false);
});
