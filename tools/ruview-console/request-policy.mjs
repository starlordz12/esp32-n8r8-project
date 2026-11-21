const allowedWrites=new Set(['/api/v1/calibration/start','/api/v1/calibration/stop','/api/v1/calibration/cancel','/api/v1/calibration/reset','/api/v1/pose/calibrate']);
export function allowsUpstreamWrite(method,path,requestOrigin,localOrigin) {
  return method==='POST'&&requestOrigin===localOrigin&&allowedWrites.has(path);
}
