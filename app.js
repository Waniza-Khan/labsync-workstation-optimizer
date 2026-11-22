/* LabSync — app logic. Sections: data/storage, time+scoring engine, actions, rendering, animation, boot. */
'use strict';
const KEY = 'labsync.v2';
const HOLD_MS = 10 * 60 * 1000;   // how long an offered slot stays reserved
const TOOLS = ['VS Code', 'Python', 'C++/GCC', 'Mic/Webcam', 'Dual Monitor'];
const STATUSES = ['Ready', 'Slow', 'Out of Order'];
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Data & persistence ---------- */
function defaults() {
  const t = {
    1: ['VS Code', 'Python', 'C++/GCC'], 2: ['VS Code', 'Python'], 3: ['VS Code', 'C++/GCC', 'Dual Monitor'], 4: ['VS Code', 'Python', 'Mic/Webcam'],
    5: ['Python', 'Mic/Webcam', 'Dual Monitor'], 6: ['VS Code', 'Python', 'C++/GCC', 'Dual Monitor'], 7: ['VS Code', 'C++/GCC'], 8: ['VS Code', 'Python', 'Mic/Webcam', 'Dual Monitor'],
    9: ['Python', 'C++/GCC'], 10: ['VS Code', 'Python', 'C++/GCC', 'Mic/Webcam', 'Dual Monitor'], 11: ['VS Code', 'Python', 'Mic/Webcam'], 12: ['VS Code', 'Python', 'C++/GCC']
  };
  const pcs = Object.keys(t).map(n => ({ id: 'PC-' + String(n).padStart(2, '0'), status: [5, 9].includes(+n) ? 'Slow' : 'Ready', tools: t[n].slice() }));
  const B = (name, pc, start, end, tools) => ({ id: uid(), name, pc, start, end, tools, state: 'confirmed' });
  return {
    pcs, wait: [], maint: [{ id: 'm1', pc: 'PC-03', start: '12:00', end: '14:00' }], bookings: [
      B('Ayesha Khan — Data Structures', 'PC-01', '09:00', '10:30', ['C++/GCC']), B('Usman Ali — C++ Practice', 'PC-03', '08:30', '10:00', ['C++/GCC']),
      B('Bilal Ahmed — ML Intro', 'PC-02', '10:00', '11:00', ['Python']), B('Sara Malik — Video Pitch', 'PC-04', '10:00', '11:30', ['Mic/Webcam']),
      B('Zain Abbas — Python Assignment', 'PC-11', '09:00', '10:00', ['Python']), B('Hamza Raza — Web Project', 'PC-06', '11:00', '13:00', ['VS Code', 'Dual Monitor']),
      B('Kiran Javed — Data Cleaning', 'PC-09', '11:00', '12:30', ['Python']), B('Hira Noman — Podcast Recording', 'PC-08', '12:00', '13:30', ['Mic/Webcam']),
      B('Danish Iqbal — Embedded Lab', 'PC-07', '13:00', '15:00', ['C++/GCC']), B('Noor Fatima — Thesis Draft', 'PC-10', '14:00', '16:00', ['Python', 'Dual Monitor']),
      B('Mahnoor Tariq — UI Review', 'PC-08', '14:30', '16:30', ['Dual Monitor', 'VS Code']), B('Iqra Shah — Interview Prep', 'PC-05', '15:00', '16:00', ['Mic/Webcam']),
      B('Faizan Qureshi — Algo Contest', 'PC-12', '16:00', '18:00', ['C++/GCC', 'Python'])]
  };
}
const uid = () => 'b' + Math.random().toString(36).slice(2, 9);
let S = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (!d || !Array.isArray(d.pcs) || d.pcs.length !== 12 || !Array.isArray(d.bookings)) throw new Error('bad shape');
    d.maint = Array.isArray(d.maint) ? d.maint : [];
    d.wait = Array.isArray(d.wait) ? d.wait : [];
    return d;
  } catch (e) { return defaults(); }
}
let DRY = false;   // true while the self-test runs: no persistence, no rendering, no toasts
const LOGKEY = 'labsync.log.v2';
let LOG = (() => { try { const a = JSON.parse(localStorage.getItem(LOGKEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } })();
function logEv(kind, msg) {   // append-only audit trail, newest first, capped
  if (DRY) return;
  LOG.unshift({ t: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), kind, msg }); LOG.length = Math.min(LOG.length, 150);
  try { localStorage.setItem(LOGKEY, JSON.stringify(LOG)); } catch (e) { /* ignore */ } renderLog();
}
function save() { if (DRY) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full/blocked: keep running in memory */ } }

/* ---------- Time helpers & scoring engine ---------- */
const toM = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const overlap = (aS, aE, bS, bE) => aS < bE && aE > bS;   // back-to-back slots do not clash

function maintClash(pcId, s, e) { return (S.maint || []).filter(m => m.pc === pcId && overlap(s, e, toM(m.start), toM(m.end))); }
function clashes(pcId, s, e, ignoreId) {
  return S.bookings.filter(b => b.pc === pcId && b.id !== ignoreId && b.state !== 'unassigned' && overlap(s, e, toM(b.start), toM(b.end)));
}
/* Score: +50 all tools, +30 Ready / +10 Slow / 0 OOO, +20 no clash. Valid = tools ok, not OOO, no clash. */
function score(pc, req, s, e, ignoreId) {
  const miss = req.filter(t => !pc.tools.includes(t)), cl = clashes(pc.id, s, e, ignoreId), mt = maintClash(pc.id, s, e), notes = [];
  let sc = 0;
  if (!miss.length) sc += 50; else notes.push('Missing: ' + miss.join(', '));
  if (pc.status === 'Ready') sc += 30;
  else if (pc.status === 'Slow') { sc += 10; notes.push('Penalty: Slow system performance'); }
  else notes.push('Disqualified: Out of Order');
  if (!cl.length && !mt.length) sc += 20;
  else { if (cl.length) notes.push('Clash: Booked ' + cl.map(b => b.start + '–' + b.end).join(', ')); if (mt.length) notes.push('Maintenance: ' + mt.map(m => m.start + '–' + m.end).join(', ')); }
  return { sc, notes, miss, cl, valid: !miss.length && pc.status !== 'Out of Order' && !cl.length && !mt.length };
}
function bestPc(req, s, e, ignoreId, excludeId) {
  let best = null;
  S.pcs.forEach(pc => {
    if (pc.id === excludeId) return;
    const r = score(pc, req, s, e, ignoreId);
    if (r.valid && (!best || r.sc > best.sc)) best = { pc, sc: r.sc };
  });
  return best;
}
function nextWindow(pc, req, s, e, ignoreId) {   // next conflict-free slot of same length on the chosen PC
  const d = e - s, tryFrom = a => { for (let t = a; t + d <= 1080; t += 30) if (!clashes(pc.id, t, t + d, ignoreId).length && !maintClash(pc.id, t, t + d).length) return t; return null; };
  const t = tryFrom(s + 30) ?? tryFrom(480);
  return t == null || t === s ? null : t;
}

/* ---------- Form state ---------- */
const F = { req: new Set(), pc: null, picked: false, open: new Set() };
const form = () => ({ s: toM($('#fStart').value), e: toM($('#fEnd').value), req: TOOLS.filter(t => F.req.has(t)) });

/* ---------- Undo history ---------- */
const hist = [];
function snap() { hist.push(JSON.stringify(S)); if (hist.length > 25) hist.shift(); }
function undo() {
  if (!hist.length) return toast('Nothing to undo.');
  S = JSON.parse(hist.pop()); logEv('undo', 'Last change undone'); save(); renderAll(); toast('Last change undone.');
}

/* ---------- Actions ---------- */
function toast(msg, act) {
  if (DRY) return;   // act = { label, fn } adds a button to the toast
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<span>${esc(msg)}</span>`;
  if (act) { const bt = document.createElement('button'); bt.className = 'btn sm primary'; bt.textContent = act.label; bt.onclick = () => { act.fn(); t.remove(); }; t.append(bt); }
  $('#toasts').append(t);
  gsap.fromTo(t, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: .4, ease: 'power3.out' });
  gsap.to(t, { opacity: 0, y: 10, delay: act ? 7 : 3.6, duration: .4, onComplete: () => t.remove() });
}
/* Scroll to a section so the person actually sees what a simulation changed */
function goTo(sel, off = -90) { window.lenis ? lenis.scrollTo(sel, { offset: off, duration: 1.3 }) : $(sel).scrollIntoView({ behavior: 'smooth' }); }
function setStatus(id, status) {
  snap(); logEv('health', `${id} set to ${status}`);
  const pc = S.pcs.find(p => p.id === id); pc.status = status;
  refreshRisk(); processWaitlist();
  save(); renderAll(); if (status === 'Out of Order') alertFx();
  gsap.fromTo(`[data-pc="${id}"]`, { scale: .94 }, { scale: 1, duration: .7, ease: 'elastic.out(1,.5)' });
}
function refreshRisk() {   // a booking is At Risk while its PC is Out of Order or a maintenance window overlaps it
  S.bookings.forEach(b => {
    if (!b.pc || b.state === 'unassigned') return;
    const pc = S.pcs.find(p => p.id === b.pc), bad = pc.status === 'Out of Order' || maintClash(b.pc, toM(b.start), toM(b.end)).length > 0;
    if (bad && (b.state === 'confirmed' || b.state === 'reassigned')) b.state = 'risk'; else if (!bad && b.state === 'risk') b.state = 'confirmed';
  });
  // a held slot on a PC that just broke or entered maintenance is released back to the queue
  S.bookings.filter(b => b.state === 'offered' && (S.pcs.find(p => p.id === b.pc).status === 'Out of Order' || maintClash(b.pc, toM(b.start), toM(b.end)).length)).forEach(b => releaseHold(b.id, true));
}
/* ---------- Waitlist with held offers ----------
   A waiting request is matched FIFO. When a PC fits, the slot is held as a booking in state 'offered', so every
   clash check protects it. The person accepts (becomes confirmed), declines, or lets it expire (slot moves on). */
function releaseHold(bid, skip) {
  const w = S.wait.find(x => x.offer && x.offer.bid === bid), b = S.bookings.find(x => x.id === bid);
  if (w) { if (skip && b) w.skip.push(`${b.pc}|${b.start}`); w.status = 'waiting'; w.offer = null; }
  S.bookings = S.bookings.filter(x => x.id !== bid);
}
function processWaitlist() {
  let n = 0;
  S.wait.filter(w => w.status === 'waiting').forEach(w => {
    const s = toM(w.start), e = toM(w.end); let best = null;
    S.pcs.forEach(pc => { if (w.skip.includes(`${pc.id}|${w.start}`)) return; const r = score(pc, w.tools, s, e); if (r.valid && (!best || r.sc > best.sc)) best = { pc, sc: r.sc }; });
    if (!best) return;
    const bk = { id: uid(), name: w.name, pc: best.pc.id, start: w.start, end: w.end, tools: w.tools, state: 'offered' };
    S.bookings.push(bk); w.status = 'offered'; w.offer = { bid: bk.id, pc: bk.pc, exp: Date.now() + HOLD_MS }; n++;
    logEv('waitlist', `Offer: ${w.name} → ${bk.pc} ${w.start}–${w.end} (held ${HOLD_MS / 60000} min)`);
    toast(`A slot opened for ${w.name}: ${bk.pc} · ${w.start}–${w.end}.`, { label: 'View offer', fn: () => goTo('#waitlist') });
  });
  return n;
}
function joinWaitlist() {
  const name = $('#fName').value.trim(), { s, e, req } = form();
  if (!name) { $('#fName').focus(); return toast('Enter your name first, then join the waitlist.'); }
  if (!(s < e)) return toast('End time must be after start time.');
  snap(); S.wait.push({ id: uid(), name, tools: req, start: fmt(s), end: fmt(e), status: 'waiting', offer: null, skip: [], t: Date.now() });
  logEv('waitlist', `${name} joined the waitlist for ${fmt(s)}–${fmt(e)}`);
  const n = processWaitlist(); save(); $('#fName').value = ''; renderAll();
  if (!n) toast(`${name} is on the waitlist. An offer will appear when a slot opens.`, { label: 'View waitlist', fn: () => goTo('#waitlist') });
}
function acceptOffer(wid) {
  const w = S.wait.find(x => x.id === wid); if (!w || !w.offer) return;
  const b = S.bookings.find(x => x.id === w.offer.bid); if (!b) return;
  snap(); b.state = 'confirmed'; S.wait = S.wait.filter(x => x.id !== wid);
  logEv('waitlist', `${w.name} accepted ${b.pc} ${b.start}–${b.end}`); save(); renderAll(); toast(`${w.name} is booked on ${b.pc} · ${b.start}–${b.end}.`);
}
function declineOffer(wid) {
  const w = S.wait.find(x => x.id === wid); if (!w || !w.offer) return;
  snap(); logEv('waitlist', `${w.name} declined ${w.offer.pc}; slot passed on`); releaseHold(w.offer.bid, true);
  processWaitlist(); save(); renderAll();
}
function removeWait(wid) { const w = S.wait.find(x => x.id === wid); if (!w) return; snap(); logEv('waitlist', `${w.name} left the waitlist`); S.wait = S.wait.filter(x => x.id !== wid); save(); renderAll(); }
function expireOffers() {
  const dead = S.wait.filter(w => w.status === 'offered' && w.offer.exp <= Date.now());
  if (!dead.length) return false;
  dead.forEach(w => { logEv('waitlist', `Offer to ${w.name} expired (${w.offer.pc})`); toast(`${w.name}'s offer expired. Passing it to the next person.`); releaseHold(w.offer.bid, true); });
  processWaitlist(); save(); renderAll(); return true;
}
function updateCd() { document.querySelectorAll('.cd').forEach(el => { const s = Math.ceil(Math.max(0, +el.dataset.exp - Date.now()) / 1000); el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }); }
function tickOffers() { if (!expireOffers()) updateCd(); }
function renderWaitlist() {
  const el = $('#offers'); if (!el) return;
  const offers = S.wait.filter(w => w.status === 'offered'), queue = S.wait.filter(w => w.status === 'waiting');
  el.innerHTML = offers.length ? offers.map(w => `<div class="offer"><div><b>${esc(w.name)}</b><span class="mono">${w.offer.pc} · ${w.start}–${w.end}</span><span class="dim">Held for <b class="cd mono" data-exp="${w.offer.exp}"></b></span></div><div class="acts"><button class="btn sm primary" data-accept="${w.id}">Accept</button><button class="btn sm" data-decline="${w.id}">Decline</button></div></div>`).join('')
    : '<div class="empty">No open offers. When a slot frees up, the first person in line gets it here.</div>';
  $('#queue').innerHTML = queue.length ? queue.map((w, i) => `<div class="qrow"><span class="qn mono">#${i + 1}</span><div><b>${esc(w.name)}</b><span class="mono dim">${w.start}–${w.end}</span><span class="chips">${w.tools.map(t => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="dim">any PC</span>'}</span></div><button class="btn sm" data-wrm="${w.id}">Remove</button></div>`).join('')
    : '<div class="empty">Nobody is waiting.</div>';
  $('#bOffers').hidden = !offers.length; $('#oN').textContent = offers.length; updateCd();
}
function addMaint(pcId, start, end) {
  if (toM(start) >= toM(end)) return toast('Maintenance end must be after its start.');
  snap(); S.maint.push({ id: uid(), pc: pcId, start, end }); refreshRisk();
  const n = S.bookings.filter(b => b.state === 'risk' && b.pc === pcId).length;
  logEv('maintenance', `${pcId} in maintenance ${start}–${end}${n ? ` (${n} booking${n === 1 ? '' : 's'} at risk)` : ''}`); save(); renderAll();
  if (n && !DRY) alertFx(); toast(n ? `${pcId} maintenance ${start}–${end}. ${n} booking${n === 1 ? ' is' : 's are'} at risk.` : `${pcId} maintenance ${start}–${end} added.`, n ? { label: 'Auto-Reassign', fn: autoReassign } : null);
}
function removeMaint(id) {
  const m = S.maint.find(x => x.id === id); if (!m) return;
  snap(); S.maint = S.maint.filter(x => x.id !== id); refreshRisk(); processWaitlist(); logEv('maintenance', `${m.pc} maintenance ${m.start}–${m.end} removed`); save(); renderAll();
}
function toggleTool(id, tool) {
  snap(); logEv('tools', `${id}: toggled ${tool}`);
  const pc = S.pcs.find(p => p.id === id);
  pc.tools = pc.tools.includes(tool) ? pc.tools.filter(t => t !== tool) : [...pc.tools, tool];
  save(); renderAll();
}
function book() {
  const name = $('#fName').value.trim(), { s, e, req } = form(), pc = S.pcs.find(p => p.id === $('#fPc').value);
  if (!name) { $('#fName').focus(); return showDiag(['Enter a student or session name.'], null, true); }
  if (!(s < e)) return showDiag(['End time must be after start time.'], null, true);
  const r = score(pc, req, s, e);
  if (!r.valid) { renderDiag(true); return shake('#diag'); }
  snap(); S.bookings.push({ id: uid(), name, pc: pc.id, start: fmt(s), end: fmt(e), tools: req, state: 'confirmed' });
  save(); $('#fName').value = ''; renderAll(); logEv('booking', `${name} booked ${pc.id} ${fmt(s)}–${fmt(e)}`); toast(`Booked ${pc.id} · ${fmt(s)}–${fmt(e)} for ${name}`);
}
function cancel(id) {
  const held = S.bookings.find(b => b.id === id && b.state === 'offered');   // cancelling a held slot = declining the offer
  if (held) { const w = S.wait.find(x => x.offer && x.offer.bid === id); if (w) return declineOffer(w.id); }
  const row = $(`[data-bid="${id}"]`);
  const done = () => { const bk = S.bookings.find(b => b.id === id); snap(); if (bk) logEv('cancel', `${bk.name} (${bk.pc || 'unassigned'} ${bk.start}–${bk.end}) cancelled`); S.bookings = S.bookings.filter(b => b.id !== id); processWaitlist(); save(); renderAll(); toast('Booking cancelled.', { label: 'Undo', fn: undo }); };
  if (!row) return done();
  gsap.to(row, { height: 0, opacity: 0, paddingBlock: 0, duration: .4, ease: 'power2.inOut', onComplete: done });
}
function autoReassign() {
  snap();
  let moved = 0, lost = 0;
  S.bookings.filter(b => b.state === 'risk').forEach(b => {
    const s = toM(b.start), e = toM(b.end), best = bestPc(b.tools, s, e, b.id, b.pc);
    if (best) { b.pc = best.pc.id; b.state = 'reassigned'; moved++; } else { b.state = 'unassigned'; b.pc = null; lost++; }
  });
  logEv('reassign', `Auto-reassign: ${moved} moved, ${lost} unassigned`); save(); renderAll(); gsap.fromTo('.row .tag.reassigned', { scale: .6 }, { scale: 1, duration: .6, ease: 'back.out(2)' });
  toast(`Auto-reassign: ${moved} moved${lost ? `, ${lost} need reschedule` : ''}.`, { label: 'Undo', fn: undo });
}
function simFailure() {
  const active = S.pcs.filter(p => p.status === 'Ready' && S.bookings.some(b => b.pc === p.id && b.state !== 'unassigned'));
  const pool = active.length ? active : S.pcs.filter(p => p.status === 'Ready');
  if (!pool.length) return toast('No Ready PC left to fail.');
  const pc = pool[Math.floor(Math.random() * pool.length)]; setStatus(pc.id, 'Out of Order');
  const n = S.bookings.filter(b => b.pc === pc.id && b.state === 'risk').length;
  goTo('#banner.banner:not([hidden]), #book', -100);
  gsap.fromTo(`[data-pc="${pc.id}"]`, { boxShadow: '0 0 0 5px rgba(239,68,68,.7)' }, { boxShadow: '0 0 0 0 rgba(239,68,68,0)', duration: 1.6, delay: .8 });
  toast(`${pc.id} went Out of Order. ${n} booking${n === 1 ? ' is' : 's are'} now at risk.`, n ? { label: 'Auto-Reassign', fn: autoReassign } : null);
}
function simRush() {
  snap();   // overlapping requests with specialised tool demands, each assigned to its best fit
  S = defaults(); S.bookings = [];
  const R = [['Lab A — C++ Exam', '09:00', '11:00', ['C++/GCC', 'VS Code']], ['Podcast Group', '09:30', '10:30', ['Mic/Webcam']], ['Design Review', '09:00', '12:00', ['Dual Monitor', 'VS Code']],
    ['ML Workshop', '10:00', '12:00', ['Python']], ['Interview Prep', '10:00', '11:00', ['Mic/Webcam', 'Python']], ['Embedded Lab', '10:00', '11:30', ['C++/GCC']],
    ['Capstone Sync', '11:00', '13:00', ['Dual Monitor', 'Python']], ['Remote Demo', '11:00', '12:00', ['Mic/Webcam', 'Dual Monitor']], ['Algo Contest', '10:30', '12:30', ['C++/GCC', 'Python']],
    ['Thesis Writing', '10:00', '11:30', ['VS Code']], ['Stats Homework', '10:00', '11:00', ['Python']], ['Screencast', '10:00', '11:00', ['Mic/Webcam', 'VS Code']], ['Dual-screen Debug', '10:00', '12:00', ['Dual Monitor', 'C++/GCC']]];
  let ok = 0;
  R.forEach(([name, st, en, tools]) => { const b = bestPc(tools, toM(st), toM(en)); if (b) { S.bookings.push({ id: uid(), name, pc: b.pc.id, start: st, end: en, tools, state: 'confirmed' }); ok++; } });
  logEv('simulation', `Peak rush loaded: ${ok} of ${R.length} requests seated`); save(); renderAll(); goTo('#book');
  gsap.fromTo('.pc', { scale: .94, opacity: .4 }, { scale: 1, opacity: 1, duration: .6, stagger: .05, delay: .7, ease: 'back.out(2)' });
  toast(`Peak rush loaded: ${ok} of ${R.length} requests were seated on the best PCs.${R.length - ok ? ` ${R.length - ok} had no PC with the right tools free.` : ''}`, { label: 'View schedule', fn: () => goTo('.sched') });
}
function reset() { snap(); logEv('reset', 'Lab state reset to defaults'); S = defaults(); F.req.clear(); F.picked = false; save(); renderAll(); toast('Lab state reset to defaults.'); }

/* ---------- Rendering ---------- */
const prevScore = {};
const openCards = new Set();   // PCs whose edit drawer is open (survives re-render)
let lastBest = null;
function renderAll() { if (DRY) return; renderKpis(); renderLog(); renderPills(); renderTools(); renderGrid(); renderPcSelect(); renderDiag(); renderBanner(); renderList(); renderTimeline(); renderAnalytics(); renderWaitlist(); $('#bUndo').disabled = !hist.length; }

/* Day timeline: PCs x 08:00-18:00, booking blocks, clickable half-hour cells, and a band for the current request */
function renderTimeline() {
  const { s, e, req } = form(), okWin = s < e;
  const hours = Array.from({ length: 10 }, (_, i) => `<span>${String(8 + i).padStart(2, '0')}:00</span>`).join('');
  const rows = S.pcs.map(pc => {
    const win = okWin ? `<div class="dt-win ${score(pc, req, s, e).valid ? 'ok' : 'bad'}" style="left:${(s - 480) / 6}%;width:${(e - s) / 6}%"></div>` : '';
    const cells = Array.from({ length: 20 }, (_, i) => `<button class="cell" data-slot="${480 + i * 30}" aria-label="Book ${pc.id} at ${fmt(480 + i * 30)}"></button>`).join('');
    const blocks = S.bookings.filter(b => b.pc === pc.id && b.state !== 'unassigned').map(b =>
      `<div class="dt-b s-${b.state}" style="left:${(toM(b.start) - 480) / 6}%;width:${(toM(b.end) - toM(b.start)) / 6}%" title="${esc(b.name)} · ${b.start}–${b.end}"><span>${esc(b.name.split(' — ')[0])}</span></div>`).join('');
    const mb = S.maint.filter(m => m.pc === pc.id).map(m => `<div class="dt-m" style="left:${(toM(m.start) - 480) / 6}%;width:${(toM(m.end) - toM(m.start)) / 6}%" title="Maintenance ${m.start}–${m.end}"><span>Maintenance</span></div>`).join('');
    return `<div class="dt-row ${pc.status === 'Out of Order' ? 'out' : ''}"><div class="dt-name"><i class="dot st-${pc.status.split(' ')[0]}"></i>${pc.id}</div><div class="dt-track" data-row="${pc.id}"><div class="cells">${cells}</div>${win}${mb}${blocks}</div></div>`;
  }).join('');
  $('#dtgrid').innerHTML = `<div class="dt-row"><div class="dt-name"></div><div class="dt-hours">${hours}</div></div>${rows}`;
}
/* Analytics: utilization, busy hours and tool demand vs supply, all derived from current state */
function renderAnalytics() {
  if (!$('#aUtil')) return;
  const act = S.bookings.filter(b => b.pc && b.state !== 'unassigned' && b.state !== 'offered'), mins = b => toM(b.end) - toM(b.start), p2 = n => String(n).padStart(2, '0');
  const rows = S.pcs.map(pc => {
    const mt = S.maint.filter(m => m.pc === pc.id).reduce((a, m) => a + toM(m.end) - toM(m.start), 0), cap = pc.status === 'Out of Order' ? 0 : Math.max(0, 600 - mt);
    const used = Math.min(cap, act.filter(b => b.pc === pc.id).reduce((a, b) => a + mins(b), 0));
    return { id: pc.id, cap, used, pct: cap ? Math.round(used / cap * 100) : 0 };
  });
  const cap = rows.reduce((a, r) => a + r.cap, 0), used = rows.reduce((a, r) => a + r.used, 0);
  const hrs = Array.from({ length: 10 }, (_, i) => ({ h: 8 + i, n: act.filter(b => overlap((8 + i) * 60, (9 + i) * 60, toM(b.start), toM(b.end))).length }));
  const peak = hrs.reduce((a, x) => x.n > a.n ? x : a, hrs[0]), maxN = Math.max(1, peak.n);
  const tools = TOOLS.map(t => ({ t, req: S.bookings.filter(b => b.tools.includes(t)).length, sup: S.pcs.filter(p => p.tools.includes(t) && p.status !== 'Out of Order').length }));
  const ratio = x => x.req / Math.max(1, x.sup), tight = tools.reduce((a, x) => ratio(x) > ratio(a) ? x : a, tools[0]), maxR = Math.max(1, ...tools.map(x => x.req));
  $('#tiles').innerHTML = `<div class="tile"><small>Lab utilization</small><b>${cap ? Math.round(used / cap * 100) : 0}%</b><span class="dim">${Math.round(used / 60)}h booked of ${Math.round(cap / 60)}h available</span></div>
    <div class="tile"><small>Busiest hour</small><b>${p2(peak.h)}:00</b><span class="dim">${peak.n} booking${peak.n === 1 ? '' : 's'} at once</span></div>
    <div class="tile"><small>Tightest tool</small><b>${esc(tight.t)}</b><span class="dim">${tight.req} request${tight.req === 1 ? '' : 's'} for ${tight.sup} working PC${tight.sup === 1 ? '' : 's'}</span></div>`;
  $('#aUtil').innerHTML = rows.map(r => `<div class="ar"><span class="mono">${r.id}</span><div class="at"><i class="${r.pct > 85 ? 'hi' : r.pct > 55 ? 'mid' : ''}" style="width:${r.pct}%"></i></div><span class="mono">${r.cap ? r.pct + '%' : 'OOO'}</span></div>`).join('');
  $('#aHours').innerHTML = hrs.map(x => `<div class="acol"><b class="mono">${x.n}</b><div class="abar"><i style="height:${x.n / maxN * 100}%"></i></div><small class="mono">${p2(x.h)}</small></div>`).join('');
  $('#aTools').innerHTML = tools.map(x => `<div class="ar wide"><span>${esc(x.t)}</span><div class="at"><i style="width:${x.req / maxR * 100}%"></i></div><span class="mono">${x.req}/${x.sup}</span></div>`).join('') + '<p class="dim note2">requests / working PCs that have the tool</p>';
}
function pickSlot(cell) {   // empty slot clicked: prefill the booking form with that PC and time
  let m = +cell.dataset.slot; const f = form(), d = f.s < f.e ? f.e - f.s : 60;
  if (m + d > 1080) m = 1080 - d;
  $('#fStart').value = fmt(m); $('#fEnd').value = fmt(m + d); F.pc = cell.closest('.dt-track').dataset.row; F.picked = true;
  onFormChange(); goTo('#book'); setTimeout(() => $('#fName').focus({ preventScroll: true }), 900);
  gsap.fromTo('#panel', { boxShadow: '0 0 0 4px rgba(52,211,153,.7)' }, { boxShadow: '0 0 0 0 rgba(52,211,153,0)', duration: 1.6, delay: .8 });
  toast(`${F.pc} · ${fmt(m)}–${fmt(m + d)} selected. Add a name and confirm.`);
}
/* Best time finder: scans the whole day for the best-scoring PC at each start time */
function findBest() {
  const { s, e, req } = form(), d = s < e ? e - s : 60, found = [];
  for (let t = 480; t + d <= 1080; t += 30) { const b = bestPc(req, t, t + d); if (b) found.push({ t, pc: b.pc.id, sc: b.sc }); }
  found.sort((a, b) => b.sc - a.sc || a.t - b.t);
  $('#finder').innerHTML = found.length ? found.slice(0, 3).map(x => `<div class="sg"><span><b>${fmt(x.t)}–${fmt(x.t + d)}</b> on ${x.pc} <em class="mono">${x.sc}/100</em></span><button class="btn sm primary" data-use-t="${x.t}" data-use-pc="${x.pc}" data-d="${d}">Use this</button></div>`).join('')
    : '<div class="sg"><span class="dim">No free slot today has all these tools. Try fewer tools or a shorter time.</span></div>';
  gsap.from('#finder .sg', { y: 14, opacity: 0, stagger: .08, duration: .4 });
}

let kv = { kReady: 0, kBook: 0, kAlert: 0 };
function renderKpis() {
  const v = { kReady: S.pcs.filter(p => p.status === 'Ready').length, kBook: S.bookings.filter(b => b.state !== 'unassigned' && b.state !== 'offered').length, kAlert: S.bookings.filter(b => b.state === 'risk' || b.state === 'unassigned').length };
  Object.keys(v).forEach(k => { const o = { n: kv[k] }; gsap.to(o, { n: v[k], duration: .8, ease: 'power2.out', onUpdate: () => $('#' + k).textContent = Math.round(o.n) }); kv[k] = v[k]; });
}
function renderPills() {
  $('#pills').innerHTML = TOOLS.map(t => `<button class="pill ${F.req.has(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
  const { s, e } = form(); $('#winLabel').textContent = fmt(s) + '–' + fmt(e);
}
function renderTools() {
  $('#fTools').innerHTML = TOOLS.map(t => `<label><input type="checkbox" data-t="${esc(t)}" ${F.req.has(t) ? 'checked' : ''}>${esc(t)}</label>`).join('');
}
const timeOpts = (a, b, sel) => { let h = ''; for (let m = a; m <= b; m += 30) h += `<option ${fmt(m) === sel ? 'selected' : ''}>${fmt(m)}</option>`; return h; };
function renderGrid() {
  const { s, e, req } = form(), valid = s < e;
  const rs = S.pcs.map(pc => ({ pc, r: valid ? score(pc, req, s, e) : score(pc, req, 0, 0) }));
  let best = null; rs.forEach(x => { if (x.r.valid && x.r.sc >= 80 && (!best || x.r.sc > best.r.sc)) best = x; });
  $('#grid').innerHTML = rs.map(({ pc, r }) => {
    const isBest = best && best.pc.id === pc.id, out = pc.status === 'Out of Order';
    const bks = S.bookings.filter(b => b.pc === pc.id && b.state !== 'unassigned');
    const segs = bks.map(b => { const l = (toM(b.start) - 480) / 600 * 100, w = (toM(b.end) - toM(b.start)) / 600 * 100; return `<span class="${b.state === 'risk' ? 'risk' : ''}" style="left:${l}%;width:${w}%" title="${esc(b.name)} ${b.start}–${b.end}"></span>`; }).join('');
    const mts = S.maint.filter(m => m.pc === pc.id), free = TOOLS.filter(t => !pc.tools.includes(t));
    const cls = r.valid ? 'ok' : (r.sc < 50 ? 'bad' : '');
    const verdict = out ? 'Out of order — cannot be booked' : r.miss.length ? 'Missing ' + r.miss.join(', ') : r.cl.length ? 'Booked ' + r.cl.map(b => b.start + '–' + b.end).join(', ') : pc.status === 'Slow' ? 'Free, but runs slow' : 'Free for this window';
    const vc = r.valid ? (pc.status === 'Slow' ? 'warn' : 'good') : 'bad', open = F.open.has(pc.id);
    return `<article class="pc st-${pc.status.split(' ')[0]} ${isBest ? 'best' : ''} ${out ? 'out' : ''} ${req.length && !r.valid && !out ? 'dim' : ''} ${openCards.has(pc.id) ? 'open' : ''}" data-pc="${pc.id}">
      <div class="glow"></div>
      <header class="ph"><div><span class="pcn">${pc.id}</span><span class="spill"><i class="dot"></i>${pc.status}</span></div>
        <div class="sc ${cls}"><span class="score" data-s="${r.sc}">${prevScore[pc.id] ?? r.sc}</span><small>/100</small></div></header>
      ${isBest ? '<div class="crown">♛ Recommended best fit</div>' : ''}
      <div class="chips">${pc.tools.map(t => `<span class="chip ${req.includes(t) ? 'hit' : ''}">${esc(t)}</span>`).join('') || '<span class="dim">No tools installed</span>'}</div>
      <div class="tl"><div class="tlh"><span>Today</span><span>${bks.length} booking${bks.length === 1 ? '' : 's'}</span></div><div class="bar">${segs}${mts.map(m => `<span class="maint" style="left:${(toM(m.start) - 480) / 6}%;width:${(toM(m.end) - toM(m.start)) / 6}%" title="Maintenance ${m.start}–${m.end}"></span>`).join('')}</div><div class="ticks"><span>08</span><span>11</span><span>14</span><span>18</span></div></div>
      <p class="why ${r.valid ? 'ok' : (out || r.cl.length ? 'bad' : '')}">${r.valid ? (r.notes.join(' · ') || 'Free and ready for this window') : esc(r.notes.join(' · '))}</p>
      <button class="editbtn" data-edit>${openCards.has(pc.id) ? 'Done' : 'Edit PC'}</button>
      <div class="edit" ${openCards.has(pc.id) ? '' : 'hidden'}>
        <div class="lbl">Health</div><div class="seg">${STATUSES.map(st => `<button class="${st.split(' ')[0]} ${pc.status === st ? 'on' : ''}" data-st="${st}">${st}</button>`).join('')}</div>
        <div class="lbl">Installed tools</div><div class="chips">${pc.tools.map(t => `<span class="chip">${esc(t)}<i data-rm="${esc(t)}" title="Remove ${esc(t)}">×</i></span>`).join('')}
          ${free.length ? `<select class="addtool" data-add aria-label="Add tool"><option value="">+ Add tool</option>${free.map(t => `<option>${esc(t)}</option>`).join('')}</select>` : ''}</div>
        <div class="lbl">Maintenance windows</div>
        <div class="chips">${mts.map(m => `<span class="chip warnchip">${m.start}–${m.end}<i data-mrm="${m.id}" title="Remove window">×</i></span>`).join('') || '<span class="dim">None scheduled</span>'}</div>
        <div class="mrow"><select data-ms aria-label="Maintenance start">${timeOpts(480, 1050, '12:00')}</select><span class="dim">to</span><select data-me aria-label="Maintenance end">${timeOpts(510, 1080, '14:00')}</select><button class="btn sm" data-madd>Add</button></div></div></article>`;
  }).join('');
  // animate score counters; pulse newly crowned card
  document.querySelectorAll('.score').forEach(el => {
    const id = el.closest('.pc').dataset.pc, to = +el.dataset.s, o = { n: prevScore[id] ?? to };
    gsap.to(o, { n: to, duration: .6, ease: 'power2.out', onUpdate: () => el.textContent = Math.round(o.n) }); prevScore[id] = to;
  });
  const bid = best ? best.pc.id : null;
  if (bid && bid !== lastBest) { const c = $(`[data-pc="${bid}"]`); gsap.fromTo(c, { scale: .96 }, { scale: 1, duration: .8, ease: 'elastic.out(1,.5)' }); gsap.fromTo(c, { boxShadow: '0 0 0 rgba(16,185,129,0)' }, { boxShadow: '0 0 40px rgba(16,185,129,.5)', yoyo: true, repeat: 1, duration: .45 }); }
  lastBest = bid; F.best = bid;
}
function renderPcSelect() {
  const sel = $('#fPc'), { s, e, req } = form();
  if (!F.picked && F.best) F.pc = F.best;
  if (!F.pc) F.pc = S.pcs[0].id;
  sel.innerHTML = S.pcs.map(pc => { const r = score(pc, req, s < e ? s : 0, s < e ? e : 0); return `<option value="${pc.id}" ${pc.id === F.pc ? 'selected' : ''}>${pc.id} · ${pc.status} · ${r.sc}${pc.id === F.best ? ' ★ best' : ''}</option>`; }).join('');
}
let lastDiag = '';
function renderDiag(shakeIt) {
  const { s, e, req } = form(), box = $('#diag');
  if (!(s < e)) return showDiag(['End time must be after start time (08:00–18:00).'], null, false);
  const pc = S.pcs.find(p => p.id === ($('#fPc').value || F.pc)), r = score(pc, req, s, e);
  const note = n => `<small class="note">${esc(n)}</small>`;
  if (r.valid) { box.className = 'diag ok'; box.innerHTML = `<div class="dh"><span class="ic">✓</span><div><b>${pc.id} is free and ready</b><small class="mono">Score ${r.sc}/100 · ${fmt(s)}–${fmt(e)}</small></div></div>${r.notes.map(note).join('')}`; lastDiag = ''; return; }
  const alt = bestPc(req, s, e, null, pc.id), nw = nextWindow(pc, req, s, e);
  box.className = 'diag bad';
  box.innerHTML = `<div class="dh"><span class="ic">!</span><div><b>${pc.id} can’t take this request</b></div></div>
    ${r.notes.filter(n => !n.startsWith('Clash')).map(note).join('')}${r.cl.map(b => note(`Overlaps “${b.name}” (${b.start}–${b.end})`)).join('')}
    <div class="sg">${alt ? `<span>Better PC: <b>${alt.pc.id}</b> <em class="mono">${alt.sc}/100</em></span><button class="btn sm primary" data-alt="${alt.pc.id}">Switch to Suggested Option</button>` : '<span class="dim">No other PC fits this window.</span>'}</div>
    <div class="sg">${nw != null ? `<span>Next free slot: <b>${fmt(nw)}–${fmt(nw + e - s)}</b> on ${pc.id}</span><button class="btn sm primary" data-win="${nw}">Switch to Suggested Option</button>` : '<span class="dim">No free window left today on this PC.</span>'}</div>
    ${alt ? '' : `<div class="sg"><span>No PC fits this request right now.</span><button class="btn sm primary" data-wl>Join waitlist</button></div>`}`;
  const sig = pc.id + r.notes.join();
  if (shakeIt || sig !== lastDiag) { lastDiag = sig; shake('#diag'); }
}
function showDiag(msgs, _x, doShake) { const b = $('#diag'); b.className = 'diag bad'; b.innerHTML = msgs.map(m => `<b>${esc(m)}</b>`).join(''); if (doShake) shake('#diag'); }
function renderBanner() {
  const n = S.bookings.filter(b => b.state === 'risk').length, u = S.bookings.filter(b => b.state === 'unassigned').length, el = $('#banner'), was = !el.hidden;
  if (!n && !u) { el.hidden = true; return; }
  el.innerHTML = `<b>⚠ PC unavailable</b><span class="mono">${n} booking${n === 1 ? '' : 's'} at risk${u ? ` · ${u} unassigned` : ''}</span>${n ? '<button class="btn sm danger" id="bAuto">Auto-Reassign Affected</button>' : '<span class="mono">Reschedule unassigned bookings from the timeline.</span>'}`;
  el.hidden = false; if (!was) alertFx();
}
function renderList() {
  const f = $('#fFilter').value, items = S.bookings.filter(b => f === 'all' || b.state === f).sort((a, b) => a.start.localeCompare(b.start));
  const label = { confirmed: 'Confirmed', risk: 'At risk / displaced', reassigned: 'Reassigned', unassigned: 'Unassigned — needs reschedule', offered: 'Offer pending' };
  const periods = [['Morning', '08:00–12:00', 0, 720], ['Afternoon', '12:00–15:00', 720, 900], ['Late afternoon', '15:00–18:00', 900, 1080]];
  const row = b => `<div class="row s-${b.state}" data-bid="${b.id}">
    <div class="who"><span class="av">${esc(b.name.trim()[0] || '?')}</span><b>${esc(b.name)}</b></div>
    <span class="mono pcl">${b.pc || '—'}</span><span class="mono">${b.start}–${b.end}</span>
    <span class="chips">${b.tools.map(t => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="dim">No special tools</span>'}</span>
    <span class="tag ${b.state}">${label[b.state]}</span><button class="btn sm" data-cancel="${b.id}">Cancel</button></div>`;
  const html = periods.map(([name, span, lo, hi]) => {
    const g = items.filter(b => toM(b.start) >= lo && toM(b.start) < hi);
    return g.length ? `<div class="psec"><div class="phead"><h3>${name}</h3><span class="mono dim">${span} · ${g.length} booking${g.length === 1 ? '' : 's'}</span></div>${g.map(row).join('')}</div>` : '';
  }).join('');
  $('#list').innerHTML = html || '<div class="empty">No bookings in this view. Create one from the booking panel.</div>';
}

function renderLog() {
  const el = $('#log'); if (!el) return;
  el.innerHTML = LOG.length ? LOG.slice(0, 40).map(x => `<div class="lg k-${x.kind}"><span class="mono dim">${x.t}</span><span class="lk">${x.kind}</span><span>${esc(x.msg)}</span></div>`).join('')
    : '<div class="empty">No activity yet. Every booking, cancellation, health change and reassignment is recorded here.</div>';
}
function exportCsv() {
  const q = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };   // guards against spreadsheet formula injection
  const rows = [['Name', 'PC', 'Start', 'End', 'Tools', 'Status'], ...S.bookings.slice().sort((a, b) => a.start.localeCompare(b.start)).map(b => [b.name, b.pc || 'UNASSIGNED', b.start, b.end, b.tools.join(' + '), b.state])];
  const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'labsync-schedule.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('Schedule exported as CSV.');
}
/* Built-in self-test: runs the scheduling engine against fixtures in DRY mode, then restores the real state */
function runSelfTests() {
  const keep = S, keepHist = hist.splice(0), res = [];
  DRY = true;
  const t = (name, fn) => { try { res.push([name, !!fn()]); } catch (e) { res.push([`${name} — ${e.message}`, false]); } };
  const fresh = () => { S = defaults(); }, bk = n => S.bookings.find(b => b.name.startsWith(n));
  try {
    t('Back-to-back slots do not overlap', () => !overlap(600, 660, 660, 720) && !overlap(660, 720, 600, 660));
    t('Partial and contained intervals overlap', () => overlap(600, 660, 630, 700) && overlap(600, 720, 630, 660));
    t('Time helpers round-trip (09:30)', () => fmt(toM('09:30')) === '09:30');
    t('Ready PC, all tools, free slot scores 100', () => { fresh(); const r = score(S.pcs[9], ['Python', 'Mic/Webcam'], 480, 540); return r.sc === 100 && r.valid; });
    t('Slow PC scores 80 and stays valid', () => { fresh(); const r = score(S.pcs[4], ['Python'], 480, 540); return r.sc === 80 && r.valid && r.notes.some(n => n.includes('Slow')); });
    t('Out of Order PC is disqualified', () => { fresh(); S.pcs[0].status = 'Out of Order'; const r = score(S.pcs[0], [], 480, 540); return !r.valid && r.notes.some(n => n.includes('Out of Order')); });
    t('Missing tool is named and blocks the PC', () => { fresh(); const r = score(S.pcs[1], ['Mic/Webcam'], 480, 540); return !r.valid && r.notes.includes('Missing: Mic/Webcam'); });
    t('Clash detected only on real overlap', () => { fresh(); return clashes('PC-01', 600, 660).length === 1 && clashes('PC-01', 630, 690).length === 0; });
    t('Clash message shows the conflicting booking', () => { fresh(); return score(S.pcs[0], [], 600, 660).notes.some(n => n.startsWith('Clash: Booked 09:00–10:30')); });
    t('Next free window skips to 10:30', () => { fresh(); return nextWindow(S.pcs[0], [], 540, 600) === 630; });
    t('Best PC ignores Out of Order machines', () => { fresh(); S.pcs.forEach(p => { if (p.id !== 'PC-07') p.status = 'Out of Order'; }); return bestPc([], 480, 540).pc.id === 'PC-07'; });
    t('No valid PC returns null', () => { fresh(); S.pcs.forEach(p => p.status = 'Out of Order'); return bestPc([], 480, 540) === null; });
    t('Breakdown flags active bookings At Risk', () => { fresh(); setStatus('PC-02', 'Out of Order'); return bk('Bilal').state === 'risk'; });
    t('Auto-reassign picks a compatible, conflict-free PC', () => { fresh(); setStatus('PC-02', 'Out of Order'); autoReassign(); const b = bk('Bilal'); return b.state === 'reassigned' && b.pc !== 'PC-02' && S.pcs.find(p => p.id === b.pc).tools.includes('Python') && clashes(b.pc, toM(b.start), toM(b.end), b.id).length === 0; });
    t('No PC left: booking becomes UNASSIGNED', () => { fresh(); S.pcs.forEach(p => { if (p.id !== 'PC-02') p.status = 'Out of Order'; }); setStatus('PC-02', 'Out of Order'); autoReassign(); const b = bk('Bilal'); return b.state === 'unassigned' && b.pc === null; });
    t('Repairing a PC restores its At Risk bookings', () => { fresh(); setStatus('PC-02', 'Out of Order'); setStatus('PC-02', 'Ready'); return bk('Bilal').state === 'confirmed'; });
    t('Undo restores the previous state', () => { fresh(); const n = S.bookings.length; snap(); S.bookings.pop(); undo(); return S.bookings.length === n; });
    t('Seed data has no double-bookings', () => { fresh(); return S.pcs.every(p => { const l = S.bookings.filter(x => x.pc === p.id); return l.every((x, i) => l.every((y, k) => i === k || !overlap(toM(x.start), toM(x.end), toM(y.start), toM(y.end)))); }); });
    t('Maintenance blocks that slot only (back-to-back is fine)', () => { fresh(); const a = score(S.pcs[2], [], 750, 810), b = score(S.pcs[2], [], 840, 900); return !a.valid && a.notes.some(n => n.startsWith('Maintenance: 12:00–14:00')) && b.valid; });
    t('Next free window skips maintenance', () => { fresh(); return nextWindow(S.pcs[2], [], 720, 780) === 840; });
    t('New maintenance flags overlapping bookings At Risk', () => { fresh(); addMaint('PC-06', '11:30', '12:00'); return bk('Hamza').state === 'risk'; });
    t('Auto-reassign moves a maintenance-displaced booking', () => { fresh(); addMaint('PC-06', '11:30', '12:00'); autoReassign(); const b = bk('Hamza'), p = S.pcs.find(x => x.id === b.pc); return b.state === 'reassigned' && b.pc !== 'PC-06' && p.tools.includes('Dual Monitor') && clashes(b.pc, toM(b.start), toM(b.end), b.id).length === 0 && !maintClash(b.pc, toM(b.start), toM(b.end)).length; });
    t('Removing maintenance restores the booking', () => { fresh(); addMaint('PC-06', '11:30', '12:00'); removeMaint(S.maint[S.maint.length - 1].id); return bk('Hamza').state === 'confirmed'; });
    t('Repairing a PC keeps maintenance-risk bookings At Risk', () => { fresh(); addMaint('PC-06', '11:30', '12:00'); setStatus('PC-06', 'Slow'); return bk('Hamza').state === 'risk'; });
    const W = (name) => ({ id: uid(), name, tools: ['C++/GCC'], start: '09:00', end: '10:30', status: 'waiting', offer: null, skip: [], t: 0 });
    const wsetup = names => {   // only PC-01 can host the request; its slot is taken by Ayesha, so everyone waits, then the slot is freed
      fresh(); S.pcs.forEach(p => { if (p.id !== 'PC-01') p.status = 'Out of Order'; }); names.forEach(n => S.wait.push(W(n))); processWaitlist();
      S.bookings = S.bookings.filter(b => !b.name.startsWith('Ayesha')); processWaitlist(); return names.map(n => S.wait.find(w => w.name === n));
    };
    t('Waitlist: nothing free keeps the request waiting', () => { fresh(); S.pcs.forEach(p => p.status = 'Out of Order'); S.wait.push(W('A')); return processWaitlist() === 0 && S.wait[0].status === 'waiting'; });
    t('Waitlist: a freed slot becomes a held offer that blocks others', () => { const [a] = wsetup(['A']); return a.status === 'offered' && S.bookings.some(b => b.state === 'offered' && b.pc === 'PC-01') && clashes('PC-01', 540, 630).length === 1; });
    t('Waitlist: accepting confirms the held slot', () => { const [a] = wsetup(['A']); acceptOffer(a.id); return S.wait.length === 0 && S.bookings.some(b => b.name === 'A' && b.state === 'confirmed'); });
    t('Waitlist: declining passes the slot to the next in line (FIFO)', () => { const [a, b] = wsetup(['A', 'B']); const first = a.status === 'offered' && b.status === 'waiting'; declineOffer(a.id); return first && b.status === 'offered' && a.status === 'waiting' && a.skip.length === 1; });
    t('Waitlist: an expired offer moves to the next person', () => { const [a, b] = wsetup(['A', 'B']); a.offer.exp = 0; return expireOffers() === true && b.status === 'offered' && a.status === 'waiting'; });
    t('Waitlist: a held slot is released if its PC breaks', () => { const [a] = wsetup(['A']); setStatus('PC-01', 'Out of Order'); return a.status === 'waiting' && !S.bookings.some(x => x.state === 'offered'); });
    t('Corrupted storage falls back to defaults', () => { const old = localStorage.getItem(KEY); localStorage.setItem(KEY, '{not json'); const d = load(); old == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, old); return d.pcs.length === 12; });
  } finally { S = keep; hist.length = 0; hist.push(...keepHist); DRY = false; renderAll(); }
  const pass = res.filter(r => r[1]).length, el = document.createElement('div'); el.className = 'modal';
  el.innerHTML = `<div class="mbox"><h2>Engine self-test</h2><p class="${pass === res.length ? 'okt' : 'badt'}">${pass} of ${res.length} checks passed</p><ul>${res.map(([n, ok]) => `<li class="${ok ? 'p' : 'f'}">${ok ? '✓' : '✗'} ${esc(n)}</li>`).join('')}</ul><button class="btn primary">Close</button></div>`;
  el.onclick = ev => { if (ev.target === el || ev.target.tagName === 'BUTTON') gsap.to(el, { opacity: 0, duration: .2, onComplete: () => el.remove() }); };
  document.body.append(el); gsap.from(el.firstChild, { y: 30, opacity: 0, duration: .4 });
  return res;
}

/* ---------- Animation helpers ---------- */
function shake(sel) { gsap.fromTo(sel, { x: 0 }, { x: 0, keyframes: { x: [-6, 6, -4, 4, 0] }, duration: .45, ease: 'power2.out' }); }
function alertFx() { const b = $('#banner'); if (b.hidden) return; shake(b); gsap.fromTo(b, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: .5, ease: 'power3.out' }); }

/* ---------- Events ---------- */
function onFormChange() { renderPills(); renderTools(); renderGrid(); renderPcSelect(); renderDiag(); renderTimeline(); }
document.addEventListener('click', ev => {
  const t = ev.target, q = s => t.closest(s);
  if (q('[data-edit]')) toggleEdit(q('.pc'));
  else if (q('[data-wl]')) joinWaitlist();
  else if (q('[data-accept]')) acceptOffer(q('[data-accept]').dataset.accept);
  else if (q('[data-decline]')) declineOffer(q('[data-decline]').dataset.decline);
  else if (q('[data-wrm]')) removeWait(q('[data-wrm]').dataset.wrm);
  else if (q('[data-madd]')) { const c = q('.pc'); addMaint(c.dataset.pc, $('[data-ms]', c).value, $('[data-me]', c).value); }
  else if (q('[data-mrm]')) removeMaint(q('[data-mrm]').dataset.mrm);
  else if (q('.cell')) pickSlot(q('.cell'));
  else if (q('[data-use-pc]')) { const u = q('[data-use-pc]'), t0 = +u.dataset.useT, d0 = +u.dataset.d; $('#fStart').value = fmt(t0); $('#fEnd').value = fmt(t0 + d0); F.pc = u.dataset.usePc; F.picked = true; onFormChange(); toast(`Set ${fmt(t0)}–${fmt(t0 + d0)} on ${F.pc}.`); }
  else if (q('.pill')) { const k = q('.pill').dataset.t; F.req.has(k) ? F.req.delete(k) : F.req.add(k); F.picked = false; onFormChange(); }
  else if (q('[data-manage]')) { const id = q('.pc').dataset.pc; F.open.has(id) ? F.open.delete(id) : F.open.add(id); renderGrid(); }
  else if (q('[data-st]')) setStatus(q('.pc').dataset.pc, q('[data-st]').dataset.st);
  else if (q('[data-rm]')) toggleTool(q('.pc').dataset.pc, q('[data-rm]').dataset.rm);
  else if (q('[data-cancel]')) cancel(q('[data-cancel]').dataset.cancel);
  else if (q('[data-alt]')) { F.pc = q('[data-alt]').dataset.alt; F.picked = true; renderPcSelect(); renderDiag(); }
  else if (q('[data-win]')) { const w = +q('[data-win]').dataset.win, d = form().e - form().s; $('#fStart').value = fmt(w); $('#fEnd').value = fmt(w + d); F.picked = true; onFormChange(); }
  else if (q('#bAuto')) autoReassign();
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.matches('#fTools input')) { t.checked ? F.req.add(t.dataset.t) : F.req.delete(t.dataset.t); F.picked = false; onFormChange(); }
  else if (t.matches('[data-add]')) { if (t.value) toggleTool(t.closest('.pc').dataset.pc, t.value); }
  else if (t.matches('#fStart')) { if (toM($('#fEnd').value) <= toM(t.value)) $('#fEnd').value = fmt(Math.min(toM(t.value) + 60, 1080)); F.picked = false; onFormChange(); }
  else if (t.matches('#fEnd')) { F.picked = false; onFormChange(); }
  else if (t.matches('#fPc')) { F.pc = t.value; F.picked = true; renderDiag(); }
  else if (t.matches('#fFilter')) renderList();
});
$('#bBook').onclick = book; $('#bRush').onclick = simRush; $('#bFail').onclick = simFailure; $('#bReset').onclick = reset; $('#bUndo').onclick = undo; $('#bCsv').onclick = exportCsv; $('#bOffers').onclick = () => goTo('#waitlist'); $('#bTest').onclick = runSelfTests; $('#bFind').onclick = findBest;
document.addEventListener('keydown', ev => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) { ev.preventDefault(); undo(); } });

/* ---------- Card interactions ---------- */
function toggleEdit(card) {
  const id = card.dataset.pc, ed = $('.edit', card), btn = $('.editbtn', card);
  if (openCards.has(id)) { openCards.delete(id); btn.textContent = 'Edit PC'; gsap.to(ed, { height: 0, opacity: 0, duration: .3, ease: 'power2.in', onComplete: () => { ed.hidden = true; gsap.set(ed, { clearProps: 'all' }); } }); }
  else { openCards.add(id); btn.textContent = 'Done'; gsap.to(card, { rotationX: 0, rotationY: 0, y: 0, duration: .3 }); ed.hidden = false; gsap.fromTo(ed, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: .45, ease: 'power3.out' }); }
}
const gridEl = $('#grid');
gridEl.addEventListener('pointermove', ev => {   // cursor glow + light 3D tilt
  const c = ev.target.closest('.pc'); if (!c || c.classList.contains('open')) return; const r = c.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
  c.style.setProperty('--mx', x * 100 + '%'); c.style.setProperty('--my', y * 100 + '%');
  gsap.to(c, { rotationY: (x - .5) * 7, rotationX: -(y - .5) * 7, y: -4, transformPerspective: 900, duration: .4, overwrite: 'auto' });
});
gridEl.addEventListener('pointerout', ev => { const c = ev.target.closest('.pc'); if (c && !c.contains(ev.relatedTarget)) gsap.to(c, { rotationX: 0, rotationY: 0, y: 0, duration: .6, ease: 'power3.out' }); });

/* ---------- Boot ---------- */
function boot() {
  const opts = (from, to) => { let h = ''; for (let m = from; m <= to; m += 30) h += `<option>${fmt(m)}</option>`; return h; };
  $('#fStart').innerHTML = opts(480, 1050); $('#fEnd').innerHTML = opts(510, 1080);
  $('#fStart').value = '10:00'; $('#fEnd').value = '11:00';
  renderAll(); setInterval(tickOffers, 1000);   // countdowns + offer expiry
  if (window.Lenis) {   // smooth scroll driven by gsap.ticker
    const lenis = new Lenis({ lerp: .09, smoothWheel: true }); window.lenis = lenis;
    if (window.ScrollTrigger) lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {   // entrance choreography
    gsap.from('.cmd', { y: -40, opacity: 0, duration: .6, ease: 'power3.out' });
    gsap.from('.hero > *, .panel', { y: 24, opacity: 0, duration: .65, stagger: .08, ease: 'power3.out', delay: .1 });
    gsap.from('.pc', { y: 24, opacity: 0, duration: .65, stagger: .05, ease: 'power3.out', delay: .2 });
    gsap.from('.row', { y: 24, opacity: 0, duration: .65, stagger: .05, ease: 'power3.out', delay: .5 });
  }
}
if (!window.gsap) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:20px">GSAP failed to load — check your connection.</p>'); } else boot();