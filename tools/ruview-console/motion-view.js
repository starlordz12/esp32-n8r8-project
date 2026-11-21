const css=`
.measured-motion{box-sizing:border-box;width:100%;height:100%;min-height:420px;padding:20px;background:#0b1420;color:#e8f2fa;font:14px/1.5 system-ui;overflow:auto;border:1px solid #29435b;border-radius:14px}
.measured-motion h2,.measured-motion h3{margin:0 0 8px}.measured-motion p{color:#b6c8da;margin:8px 0}.measured-motion .motion-summary{font-size:24px;font-weight:700;color:#7ce6b2}
.measured-motion .motion-presence{padding:12px;margin:12px 0;background:#172637;border-left:4px solid #eab86c;border-radius:6px}
.measured-motion .motion-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
.measured-motion article{min-width:0;padding:14px;background:#132334;border:1px solid #314a63;border-radius:10px}.measured-motion canvas{width:100%;height:110px;display:block;margin-top:12px}
.measured-motion .motion-label{font-size:19px;font-weight:650}.measured-motion .motion-value{font-variant-numeric:tabular-nums;color:#bbd0e4}.measured-motion .motion-note{font-size:12px;color:#b6c8da}
`;
const words=s=>String(s||'unavailable').replaceAll('_',' ');
export class GaussianSplatRenderer {
  constructor(container) {
    this.container=container;this.cards=new Map();this.lastUpdate=0;
    if(!document.getElementById('measured-motion-style')){const style=document.createElement('style');style.id='measured-motion-style';style.textContent=css;document.head.append(style);}
    container.innerHTML='<section class="measured-motion"><h2>Live channel movement</h2><p>Measured separately at each radio. This is a time trace, not a person-location map.</p><div class="motion-summary" role="status">Connecting…</div><div class="motion-presence"><strong>Presence: unknown</strong><div>Movement alone cannot establish whether a still person is in the room.</div></div><div class="motion-grid"></div><p class="motion-note">Teal trace: measured channel change. Amber dashed line: this radio’s movement threshold. Gaps mean unavailable data. Reference checks are still pending.</p></section>';
    this.root=container.querySelector('.measured-motion');this.summary=this.root.querySelector('.motion-summary');this.presence=this.root.querySelector('.motion-presence');this.grid=this.root.querySelector('.motion-grid');
    this.expiry=setInterval(()=>{if(this.lastUpdate&&Date.now()-this.lastUpdate>1500)this.unavailable('Live feed interrupted');},500);
  }
  unavailable(reason){this.summary.textContent=reason;this.summary.style.color='#efbf80';for(const c of this.cards.values()){c.label.textContent='Unavailable';c.value.textContent='No fresh measurement';}this.presence.firstElementChild.textContent='Presence: unknown';}
  update(frame) {
    const s=frame.local_activity||frame;
    if(!Array.isArray(s.nodes)||!s.nodes.some(n=>'status' in n))return;
    this.lastUpdate=Date.now();
    this.summary.textContent=s.status==='live'?words(s.label):'Movement unavailable';this.summary.style.color=s.status==='live'?'#7ce6b2':'#efbf80';
    const p=s.calibrated_presence;
    this.presence.firstElementChild.textContent=p?.status==='live'?`Presence: ${p.presence?'present':'empty'}`:'Presence: unknown';
    this.presence.lastElementChild.textContent=p?.status==='live'?`Calibrated link at node ${p.node_id}; short independent checks passed. No person count or location is inferred.`:p?.status==='experimental'?`Pi baseline candidate: ${p.presence?'present':'empty'} on node ${p.node_id}. Not independently validated.`:p?`Pi presence unavailable: ${words(p.reason)}. Stationary presence has not passed independent checks.`:'Stationary presence has not passed independent empty-room and seated checks.';
    const ids=new Set(s.nodes.map(n=>n.node_id));for(const [id,c]of this.cards)if(!ids.has(id)){c.article.remove();this.cards.delete(id);}
    for(const n of s.nodes){
      let c=this.cards.get(n.node_id);
      if(!c){const article=document.createElement('article');article.innerHTML='<h3></h3><div class="motion-label"></div><div class="motion-value"></div><canvas width="480" height="150" role="img"></canvas><div class="motion-note"></div>';article.querySelector('h3').textContent=`Node ${n.node_id}`;this.grid.append(article);c={article,label:article.querySelector('.motion-label'),value:article.querySelector('.motion-value'),canvas:article.querySelector('canvas'),note:article.querySelector('.motion-note'),points:[],lastTick:null};this.cards.set(n.node_id,c);}
      const live=n.status==='live'&&Number.isFinite(n.motion)&&Number.isFinite(n.motion_threshold);
      c.label.textContent=live?words(n.label):'Unavailable';c.label.style.color=live?(n.label==='movement_detected'?'#ffbd77':'#7ce6b2'):'#efbf80';
      c.value.textContent=live?`${n.motion.toFixed(5)} / threshold ${n.motion_threshold.toFixed(5)}`:'No fresh motion measurement';
      c.note.textContent=live?`${(n.motion/n.motion_threshold).toFixed(2)}× threshold · ${s.coverage==='partial'?'partial room coverage':'live radio'}`:words(n.reason);
      const time=Date.now();if(!live||n.source_tick!==c.lastTick){c.points.push({time,value:live?n.motion:null});c.lastTick=n.source_tick;}
      c.points=c.points.filter(p=>time-p.time<30000);this.draw(c,n.motion_threshold,time);
    }
  }
  draw(c,threshold,now){
    const ctx=c.canvas.getContext('2d');if(!ctx)return;const w=c.canvas.width,h=c.canvas.height;ctx.clearRect(0,0,w,h);
    if(!Number.isFinite(threshold)||threshold<=0)return;
    const max=Math.max(threshold*2,...c.points.map(p=>p.value||0))*1.1,y=v=>h-12-v/max*(h-24);
    ctx.strokeStyle='#eab86c';ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(0,y(threshold));ctx.lineTo(w,y(threshold));ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle='#59dcc3';ctx.lineWidth=2;ctx.beginPath();let pen=false,lastTime=null;
    for(const p of c.points){if(p.value===null){pen=false;continue;}const x=w-(now-p.time)/30000*w;if(lastTime&&p.time-lastTime>600)pen=false;if(pen)ctx.lineTo(x,y(p.value));else ctx.moveTo(x,y(p.value));pen=true;lastTime=p.time;}ctx.stroke();
    c.canvas.setAttribute('aria-label',`Measured movement over the last 30 seconds; threshold ${threshold.toFixed(5)}`);
  }
  resize(){}
  dispose(){clearInterval(this.expiry);this.container.textContent='';}
}

export function startMotionObservatory(container){
  const view=new GaussianSplatRenderer(container);let stopped=false,timer;
  async function refresh(){try{const r=await fetch('/local/activity/status',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw new Error();const s=await r.json();if(!stopped)view.update(s);}catch{if(!stopped)view.unavailable('Connection unavailable');}finally{if(!stopped)timer=setTimeout(refresh,300);}}
  refresh();return()=>{stopped=true;clearTimeout(timer);view.dispose();};
}
