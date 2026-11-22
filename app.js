'use strict';

const DATA_KEY = 'labsync.v2';
const LOG_KEY = 'labsync.log.v2';
const OPEN = 8 * 60;
const CLOSE = 18 * 60;
const toolsCatalog = ['CAD','GPU','3D Print','VR','Compiler','Video'];

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const toTime = minutes => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const fromTime = value => { const [h,m] = value.split(':').map(Number); return h * 60 + m; };
const clone = value => JSON.parse(JSON.stringify(value));

let state;
let undoStack = [];
let editingPc = null;
let selectedPc = 'PC-01';

function seedState() {
  const pcs = [];
  for (let i = 1; i <= 12; i++) {
    const toolSets = [
      ['CAD','Compiler'], ['GPU','VR'], ['3D Print','CAD'], ['Compiler','Video'],
      ['GPU','Compiler'], ['VR','Video'], ['CAD','3D Print'], ['GPU','CAD'],
      ['Compiler','Video'], ['3D Print','VR'], ['GPU','Compiler','CAD'], ['Video','Compiler']
    ];
    pcs.push({ id:`PC-${pad(i)}`, status:i === 7 ? 'offline' : (i === 4 || i === 9 ? 'occupied' : 'available'), health: i === 7 ? 38 : 82 + (i % 17), tools:[...toolSets[i-1]], score:0 });
  }
  const bookings = [
    { id:crypto.randomUUID(), name:'Architecture Lab', pc:'PC-03', start:9*60, end:11*60, tools:['CAD','3D Print'] },
    { id:crypto.randomUUID(), name:'AI Training', pc:'PC-02', start:13*60, end:16*60, tools:['GPU','VR'] },
    { id:crypto.randomUUID(), name:'Video Editing', pc:'PC-10', start:10*60, end:12*60, tools:['Video','Compiler'] },
    { id:crypto.randomUUID(), name:'Coding Workshop', pc:'PC-05', start:14*60, end:17*60, tools:['GPU','Compiler'] }
  ];
  const waitlist = [
    { id:crypto.randomUUID(), name:'Maya Chen', start:11*60, end:12*60, tools:['CAD'], offerPc:null, expiresAt:null },
    { id:crypto.randomUUID(), name:'Leo Martins', start:15*60, end:17*60, tools:['GPU'], offerPc:null, expiresAt:null }
  ];
  return { pcs, bookings, waitlist };
}

function load() {
  try { state = JSON.parse(localStorage.getItem(DATA_KEY)) || seedState(); }
  catch (_) { state = seedState(); }
  if (!state.pcs || state.pcs.length !== 12) state = seedState();
  scoreAll();
}

function save() {
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
  log('State saved');
  render();
}

function pushUndo() { undoStack.push(clone(state)); if (undoStack.length > 30) undoStack.shift(); }
function undo() {
  if (!undoStack.length) return toast('Nothing to undo');
  state = undoStack.pop();
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
  log('Undo performed');
  render();
  toast('Last change undone');
}

function audit(message) {
  const logs = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  logs.unshift({ time:Date.now(), message });
  localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0,200)));
}
function log(message) { audit(message); renderAudit(); }

function scorePc(pc) {
  const nowBooked = state.bookings.filter(b => b.pc === pc.id).length;
  const toolMatch = pc.tools.length;
  let score = pc.health * 0.55 + toolMatch * 8 - nowBooked * 3;
  if (pc.status === 'offline') score = 5;
  if (pc.status === 'occupied') score *= 0.85;
  pc.score = Math.max(0, Math.min(100, Math.round(score)));
  return pc.score;
}
function scoreAll() {
  state.pcs.forEach(scorePc);
  const available = state.pcs.filter(p => p.status !== 'offline').sort((a,b) => b.score-a.score);
  state.pcs.forEach(p => p.best = false);
  if (available[0]) available[0].best = true;
}

function overlaps(aStart,aEnd,bStart,bEnd) { return aStart < bEnd && aEnd > bStart; }
function pcIsFree(pcId,start,end,excludeId) {
  return state.bookings.every(b => b.id === excludeId || b.pc !== pcId || !overlaps(start,end,b.start,b.end));
}

function getSuggestions(required,start,end) {
  const requiredSet = new Set(required.map(t => t.trim().toLowerCase()).filter(Boolean));
  return state.pcs.filter(p => p.status !== 'offline').map(pc => {
    const tools = pc.tools.map(t => t.toLowerCase());
    const matching = [...requiredSet].filter(t => tools.includes(t)).length;
    const toolScore = requiredSet.size ? matching / requiredSet.size : 1;
    const score = pc.score + toolScore * 30;
    return { pc, free:pcIsFree(pc.id,start,end), toolScore, score };
  }).sort((a,b) => b.score-a.score);
}

function findNextSlot(pcId,start,end) {
  const duration = end-start;
  for (let candidate=start; candidate+duration<=CLOSE; candidate+=30) {
    if (pcIsFree(pcId,candidate,candidate+duration)) return candidate;
  }
  return null;
}

function createBooking(name,pcId,start,end,tools) {
  if (!name.trim()) return toast('Enter a booking name');
  if (end <= start) return toast('End time must be after start time');
  const pc = state.pcs.find(p => p.id === pcId);
  if (!pc || pc.status === 'offline') return toast('This workstation is offline');
  if (!pcIsFree(pcId,start,end)) {
    const suggestions = getSuggestions(tools,start,end).filter(s => s.free);
    const alternative = suggestions[0];
    const next = findNextSlot(pcId,start,end);
    let message = 'Slot clash detected.';
    if (alternative) message += ` Alternative: ${alternative.pc.id}.`;
    if (next !== null) message += ` Next free for selected PC: ${toTime(next)}.`;
    $('conflictBanner').hidden = false;
    $('conflictBanner').innerHTML = `${message} <button id="clashAuto" class="ghost">Auto-resolve</button>`;
    $('clashAuto').onclick = () => {
      if (alternative) addBooking(name,alternative.pc.id,start,end,tools);
      else if (next !== null) addBooking(name,pcId,next,next+(end-start),tools);
    };
    log(`Conflict detected for ${name}: ${pcId} ${toTime(start)}–${toTime(end)}`);
    return;
  }
  addBooking(name,pcId,start,end,tools);
}

function addBooking(name,pcId,start,end,tools) {
  pushUndo();
  state.bookings.push({ id:crypto.randomUUID(), name:name.trim(), pc:pcId, start, end, tools });
  $('conflictBanner').hidden = true;
  scoreAll(); save();
  log(`Booking created: ${name} → ${pcId} (${toTime(start)}–${toTime(end)})`);
  toast('Booking created');
}

function renderPcGrid() {
  scoreAll();
  $('pcGrid').innerHTML = state.pcs.map(pc => `
    <article class="pc-card ${pc.best ? 'best':''}" data-pc="${pc.id}">
      <div class="pc-head"><span class="pc-name">${pc.id}</span>${pc.best ? '<span class="badge">BEST FIT</span>' : ''}</div>
      <div class="score">${pc.score}<small>/100</small></div>
      <div class="status ${pc.status}">${pc.status}</div>
      <div class="tools">${pc.tools.join(' · ')}</div>
      <div class="pc-actions"><button data-edit="${pc.id}">Edit</button><button data-break="${pc.id}">${pc.status==='offline'?'Restore':'Breakdown'}</button></div>
    </article>`).join('');
  document.queryAll = undefined;
  document.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = () => openPcDialog(btn.dataset.edit));
  document.querySelectorAll('[data-break]').forEach(btn => btn.onclick = () => toggleBreakdown(btn.dataset.break));
  if (window.LabSyncFX) LabSyncFX.animateCards();
}

function openPcDialog(pcId) {
  editingPc = pcId;
  const pc = state.pcs.find(p => p.id === pcId);
  $('dialogTitle').textContent = `Edit ${pcId}`;
  $('editStatus').value = pc.status;
  $('editHealth').value = pc.health;
  $('editTools').value = pc.tools.join(', ');
  $('pcDialog').showModal();
}
function savePc() {
  if (!editingPc) return;
  pushUndo();
  const pc = state.pcs.find(p => p.id === editingPc);
  pc.status = $('editStatus').value;
  pc.health = Math.max(0,Math.min(100,Number($('editHealth').value)));
  pc.tools = $('editTools').value.split(',').map(t => t.trim()).filter(Boolean);
  scoreAll(); save();
  log(`Workstation edited: ${pc.id}`);
  toast(`${pc.id} updated`);
}

function toggleBreakdown(pcId) {
  pushUndo();
  const pc = state.pcs.find(p => p.id === pcId);
  pc.status = pc.status === 'offline' ? 'available' : 'offline';
  if (pc.status === 'offline') {
    pc.health = Math.min(pc.health,35);
    reassignAtRisk(pcId);
  } else pc.health = Math.max(pc.health,70);
  scoreAll(); save();
  log(`${pcId} ${pc.status === 'offline'?'marked offline':'restored'}`);
  toast(pc.status === 'offline' ? `${pcId} breakdown recorded` : `${pcId} restored`);
}

function reassignAtRisk(pcId) {
  const affected = state.bookings.filter(b => b.pc === pcId);
  affected.forEach(booking => {
    const alt = getSuggestions(booking.tools,booking.start,booking.end).find(s => s.free && s.pc.status !== 'offline');
    if (alt) {
      booking.pc = alt.pc.id;
      log(`Auto-reassigned ${booking.name}: ${pcId} → ${alt.pc.id}`);
    } else {
      state.waitlist.push({ id:crypto.randomUUID(), name:booking.name, start:booking.start, end:booking.end, tools:booking.tools, offerPc:null, expiresAt:null });
      state.bookings = state.bookings.filter(b => b.id !== booking.id);
      log(`Waitlisted ${booking.name}: no alternative PC`);
    }
  });
}

function renderTimeline() {
  const labels = [];
  for (let t=OPEN;t<=CLOSE;t+=60) labels.push(`<span class="hour-label" style="left:${(t-OPEN)/(CLOSE-OPEN)*100}%">${toTime(t)}</span>`);
  const rows = state.pcs.slice(0,8).map((pc,index) => {
    const blocks = state.bookings.filter(b => b.pc === pc.id).map(b => {
      const left=(b.start-OPEN)/(CLOSE-OPEN)*100, width=(b.end-b.start)/(CLOSE-OPEN)*100;
      return `<div class="timeline-block ${pc.status==='offline'?'offline':''}" style="left:${left}%;width:${width}%" title="${b.name}">${b.name}</div>`;
    }).join('');
    return `<div class="timeline-row" style="top:${index*24+18}px">${blocks}</div>`;
  }).join('');
  $('timeline').innerHTML = labels.join('')+rows;
}

function renderSchedule() {
  $('schedule').innerHTML = `<div class="schedule-list">${state.pcs.map(pc => {
    const bookings = state.bookings.filter(b=>b.pc===pc.id).sort((a,b)=>a.start-b.start);
    return bookings.length ? bookings.map(b=>`<div class="schedule-row"><strong>${pc.id}</strong><div>${b.name}<br><small>${b.tools.join(', ')}</small></div><span>${toTime(b.start)}–${toTime(b.end)}</span></div>`).join('') :
      `<div class="schedule-row"><strong>${pc.id}</strong><div class="empty">No bookings</div><span>—</span></div>`;
  }).join('')}</div>`;
}

function renderWaitlist() {
  $('waitlistCount').textContent = state.waitlist.length;
  if (!state.waitlist.length) { $('waitlist').innerHTML='<div class="empty">No waiting requests</div>'; return; }
  $('waitlist').innerHTML = state.waitlist.map((item,index)=>{
    let offerText='Offer';
    if (item.expiresAt && item.expiresAt > Date.now()) {
      const seconds=Math.max(0,Math.ceil((item.expiresAt-Date.now())/1000));
      offerText=seconds ? `Accept ${seconds}s` : 'Expired';
    }
    return `<div class="wait-item"><span class="wait-index">${pad(index+1)}</span><div><strong>${item.name}</strong><small>${toTime(item.start)}–${toTime(item.end)} · ${item.tools.join(', ')}</small></div><button class="offer" data-wait="${item.id}">${offerText}</button></div>`;
  }).join('');
  document.querySelectorAll('[data-wait]').forEach(btn=>btn.onclick=()=>{
    const item=state.waitlist.find(w=>w.id===btn.dataset.wait);
    if (item?.expiresAt && item.expiresAt>Date.now()) acceptWaitlistOffer(item);
    else offerWaitlist(btn.dataset.wait);
  });
}

function offerWaitlist(id) {
  const item=state.waitlist.find(w=>w.id===id);
  if (!item) return;
  const alt=getSuggestions(item.tools,item.start,item.end).find(s=>s.free&&s.pc.status!=='offline');
  if (!alt) return toast('No PC is currently available for this offer');
  pushUndo();
  item.offerPc=alt.pc.id;
  item.expiresAt=Date.now()+10*60*1000;
  save(); log(`10-minute offer held: ${item.name} → ${alt.pc.id}`);
  toast(`${alt.pc.id} held for ${item.name}`);
  $('waitlist').querySelector(`[data-wait="${id}"]`)?.focus();
}

function acceptWaitlistOffer(item) {
  if (!item.offerPc || !pcIsFree(item.offerPc,item.start,item.end)) return toast('The held offer is no longer valid');
  pushUndo();
  state.bookings.push({ id:crypto.randomUUID(), name:item.name, pc:item.offerPc, start:item.start, end:item.end, tools:item.tools });
  state.waitlist=state.waitlist.filter(w=>w.id!==item.id);
  $('conflictBanner').hidden=true;
  scoreAll();
  save();
  log(`Waitlist offer accepted: ${item.name} → ${item.offerPc}`);
  toast('Timed offer accepted');
}

function renderAnalytics() {
  const occupiedSlots=state.bookings.reduce((sum,b)=>sum+(b.end-b.start),0);
  const util=Math.round(occupiedSlots/(12*(CLOSE-OPEN))*100);
  const demand={};
  state.bookings.concat(state.waitlist).forEach(item=>(item.tools||[]).forEach(t=>demand[t]=(demand[t]||0)+1));
  const hourly=Array.from({length:10},(_,i)=>({hour:i+8,count:state.bookings.filter(b=>b.start<= (i+8)*60 && b.end>(i+8)*60).length}));
  const peak=hourly.sort((a,b)=>b.count-a.count)[0];
  const supplied=Object.keys(demand).filter(t=>state.pcs.some(p=>p.status==='available'&&p.tools.includes(t))).length;
  const supply=Object.keys(demand).length?Math.round(supplied/Object.keys(demand).length*100):100;
  $('utilValue').textContent=`${util}%`; $('analyticsUtil').textContent=`${util}%`; $('utilBar').style.width=`${Math.min(100,util)}%`;
  $('activeValue').textContent=state.pcs.filter(p=>p.status==='occupied'||p.status==='available').length;
  $('peakValue').textContent=peak.count?`${pad(peak.hour)}:00`:'—';
  $('toolSupply').textContent=`${supply}%`; $('supplyBar').style.width=`${supply}%`;
  $('bookingCount').textContent=state.bookings.length;
  $('toolDemand').innerHTML=Object.entries(demand).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`<span class="tool-chip">${t}<b>${n}</b></span>`).join('')||'<span class="empty">No tool demand</span>';
}

function renderAudit() {
  const logs=JSON.parse(localStorage.getItem(LOG_KEY)||'[]');
  $('auditLog').innerHTML=logs.length?logs.map(row=>`<div class="log-row"><time>${new Date(row.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><span>${escapeHtml(row.message)}</span></div>`).join(''):'<div class="empty">No audit entries</div>';
}
function escapeHtml(value){ const div=document.createElement('div'); div.textContent=value; return div.innerHTML; }

function renderWaitlistTimers() {
  const now=Date.now();
  let changed=false;
  state.waitlist.forEach(item=>{
    if (item.expiresAt && item.expiresAt<=now) {
      item.expiresAt=null; item.offerPc=null; changed=true;
    }
  });
  if (changed) localStorage.setItem(DATA_KEY,JSON.stringify(state));
  renderWaitlist();
}

function render() {
  renderPcGrid(); renderTimeline(); renderSchedule(); renderWaitlist(); renderAnalytics(); renderAudit();
  $('bookingPc').value = $('bookingPc').value || state.pcs.find(p=>p.status!=='offline')?.id;
}

function exportCsv() {
  const rows=[['Booking','PC','Start','End','Tools'],...state.bookings.map(b=>[b.name,b.pc,toTime(b.start),toTime(b.end),b.tools.join('; ')])];
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const link=document.createElement('a'); link.href=url; link.download='labsync-schedule.csv'; link.click(); URL.revokeObjectURL(url);
  log('Schedule exported to CSV');
  toast('CSV exported');
}

function runSimulation(type) {
  pushUndo();
  if(type==='rush'){
    for(let i=0;i<6;i++){
      const pc=state.pcs.find(p=>p.status==='available'&&pcIsFree(p.id,16*60,17*60));
      if(pc) state.bookings.push({id:crypto.randomUUID(),name:`Rush Session ${i+1}`,pc:pc.id,start:16*60,end:17*60,tools:[pc.tools[i%pc.tools.length]]});
    }
    log('Simulation: Peak Lab Rush');
  } else if(type==='failure'){
    const pc=state.pcs.find(p=>p.status==='available')||state.pcs[0];
    pc.status='offline'; pc.health=35; reassignAtRisk(pc.id);
    log(`Simulation: Hardware failure on ${pc.id}`);
  } else {
    undoStack=[];
    state=seedState();
    localStorage.removeItem(LOG_KEY);
    log('Lab reset');
  }
  scoreAll(); save();
  toast(type==='reset'?'Lab reset':type==='rush'?'Rush load added':'Hardware failure simulated');
}

function runSelfTest() {
  const tests=[
    ['12 workstations',state.pcs.length===12],
    ['No invalid intervals',state.bookings.every(b=>b.start>=OPEN&&b.end<=CLOSE&&b.end>b.start)],
    ['No booking clashes',(()=>{for(let i=0;i<state.bookings.length;i++)for(let j=i+1;j<state.bookings.length;j++){const a=state.bookings[i],b=state.bookings[j];if(a.pc===b.pc&&overlaps(a.start,a.end,b.start,b.end))return false;}return true;})()],
    ['Scores in range',state.pcs.every(p=>p.score>=0&&p.score<=100)]
  ];
  const failed=tests.filter(t=>!t[1]);
  log(`Engine self-test: ${failed.length?'FAIL '+failed.map(t=>t[0]).join(', '):'PASS'}`);
  toast(failed.length?'Self-test found issues':'Engine self-test passed');
  renderAudit();
}

function toast(message) {
  const el=$('toast'); el.textContent=message; el.classList.add('show');
  clearTimeout(el.hideTimer); el.hideTimer=setTimeout(()=>el.classList.remove('show'),2600);
}

function initControls() {
  for(let i=1;i<=12;i++) $('bookingPc').insertAdjacentHTML('beforeend',`<option value="PC-${pad(i)}">PC-${pad(i)}</option>`);
  for(let t=OPEN;t<=CLOSE;t+=30){ $('bookingStart').insertAdjacentHTML('beforeend',`<option value="${t}">${toTime(t)}</option>`); $('bookingEnd').insertAdjacentHTML('beforeend',`<option value="${t}">${toTime(t)}</option>`); }
  $('bookingStart').value=9*60; $('bookingEnd').value=10*60;
  $('bookBtn').onclick=()=>createBooking($('bookingName').value,$('bookingPc').value,Number($('bookingStart').value),Number($('bookingEnd').value),$('bookingTools').value.split(',').map(t=>t.trim()).filter(Boolean));
  $('undoBtn').onclick=undo;
  $('exportBtn').onclick=exportCsv;
  $('savePcBtn').onclick=e=>{e.preventDefault();savePc();$('pcDialog').close();};
  $('clearLogBtn').onclick=()=>{localStorage.removeItem(LOG_KEY);renderAudit();};
  $('selfTestBtn').onclick=runSelfTest;
  document.querySelectorAll('[data-sim]').forEach(btn=>btn.onclick=()=>runSimulation(btn.dataset.sim));
  $('themeBtn').onclick=()=>document.body.classList.toggle('dark');
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()){e.preventDefault();undo();}});
  setInterval(()=>{$('clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});renderWaitlistTimers();},1000);
  if(window.LabSyncFX)LabSyncFX.init();
}

load();
initControls();
render();
