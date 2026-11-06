// Fix notes: the wrench in the header. Safaan jots a change he wants in the app; it syncs to
// data/fuel/fixes.json like every other file, and Claude reads that file when asked to
// "do my fix notes" (see CLAUDE.md). Nothing here talks to Claude directly or needs a key.
// Record: { id, t (the note), where (screen it was written on), at (ms), now (asked for right away),
//           done? (ms), res? (what Claude did), pr? (link), q? (Claude's question back) }
import * as db from './db.js';

const FILE = 'fixes';
const DEFAULT_LINK = 'https://claude.ai/code';
const fmt = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export async function openCount() { return (await db.all(FILE)).filter(f => !f.done).length; }

const claudeLink = s => (s.claudeLink || '').trim() || DEFAULT_LINK;

// Copy the message and open Claude in the same tap: browsers only allow both right after a tap.
function handOff(msg, s, ui) {
  navigator.clipboard?.writeText(msg).catch(() => {});
  window.open(claudeLink(s), '_blank', 'noopener');
  ui.toast('Copied. Paste it in the Claude project chat and send.');
}
const nowMsg = f => `Fix note from Baro's Biryani, do it now: "${f.t}" (written on ${f.where}). Saved as ${f.id} in data/fuel/fixes.json.`;
const batchMsg = list => `Do my fix notes. ${list.length} waiting in data/fuel/fixes.json:\n` +
  list.map((f, i) => `${i + 1}. ${f.t} (${f.where})`).join('\n');

export async function open(s, ui, { where = 'the app', edit = null } = {}) {
  const { $, $$, esc } = ui;
  const all = (await db.all(FILE)).sort((a, b) => (b.at || 0) - (a.at || 0));
  const waiting = all.filter(f => !f.done), done = all.filter(f => f.done).sort((a, b) => b.done - a.done);
  const cur = edit ? all.find(f => f.id === edit) : null;
  const row = f => `<li data-id="${esc(f.id)}"><div class="grow"><div class="name wrap">${esc(f.t)}</div>
    <div class="sub">${esc(f.where || '')} · ${fmt(f.at)} · ${f.now ? '<b class="accent">asked for now</b>' : 'next pass'}</div>
    ${f.q ? `<div class="sub ask">Claude asks: ${esc(f.q)}</div>` : ''}</div></li>`;
  const doneRow = f => `<li class="done"><div class="grow"><div class="name wrap">${esc(f.t)}</div>
    <div class="sub">Done ${fmt(f.done)}${f.res ? ': ' + esc(f.res) : ''}${f.pr ? ` · <a href="${esc(f.pr)}" target="_blank" rel="noopener">see change</a>` : ''}</div></div></li>`;
  const b = ui.sheet(`
    <textarea id="fxT" rows="3" placeholder="What should change? e.g. let me change a workout's type on Today">${esc(cur?.t || '')}</textarea>
    <p class="small muted">Saved with: ${esc(cur?.where || where)}</p>
    <div class="actions">
      ${cur ? '<button class="danger" id="fxDel">Delete</button>' : ''}
      <button id="fxLater">${cur ? 'Save' : 'Save for later'}</button>
      <button class="primary" id="fxNow">Do it now</button>
    </div>
    ${waiting.length && !cur ? `<h4>Waiting for Claude (${waiting.length})<button class="link" id="fxAll">Send all now</button></h4>
      <ul class="list fixes">${waiting.map(row).join('')}</ul>` : ''}
    ${done.length && !cur ? `<details class="fxdone"><summary><h4>Done (${done.length})</h4></summary><ul class="list fixes">${done.slice(0, 20).map(doneRow).join('')}</ul></details>` : ''}
    ${cur ? '' : `<details class="how fxhow"><summary><h3 class="small">How this works</h3></summary>
      <p class="small"><b>Save for later</b> keeps the note here. When you want a round of fixes, say <b>"do my fix notes"</b> in the Claude project chat (or tap <b>Send all now</b>, which copies that message for you). Claude does every waiting note in one go, ships it, and they move to Done here with what changed.</p>
      <p class="small"><b>Do it now</b> saves the note, copies a message with it and opens Claude. Paste and send, and Claude starts on just that one.</p>
      <p class="small">If a note isn't clear, Claude leaves a question on it here instead of guessing. Tap the note to answer.</p>
      <form id="fxLink"><label>Claude link (opens when you send)<input name="link" inputmode="url" value="${esc(s.claudeLink || '')}" placeholder="${DEFAULT_LINK}"></label></form>
    </details>`}`, { title: cur ? 'Edit fix note' : 'Fix for Claude' });
  const ta = $('#fxT', b);
  const save = async now => {
    const t = ta.value.trim();
    if (!t) { ui.toast('Type what you want changed first'); ta.focus(); return null; }
    // An edit clears Claude's question: the edited note is the answer.
    return db.put(FILE, { ...(cur || { at: Date.now(), where }), t, now: now || !!cur?.now, q: undefined });
  };
  $('#fxLater', b).onclick = async () => { if (await save(false)) { ui.closeSheet(); ui.toast(cur ? 'Saved' : 'Saved for the next fix pass'); ui.render(); } };
  $('#fxNow', b).onclick = () => {
    const t = ta.value.trim();
    if (!t) { ui.toast('Type what you want changed first'); return ta.focus(); }
    const id = cur?.id || db.uid();
    handOff(nowMsg({ id, t, where: cur?.where || where }), s, ui);
    db.put(FILE, { ...(cur || { at: Date.now(), where }), id, t, now: true, q: undefined }).then(() => { ui.closeSheet(); ui.render(); });
  };
  $('#fxDel', b)?.addEventListener('click', async () => {
    await db.remove(FILE, cur.id); ui.closeSheet(); ui.render();
    ui.toast('Deleted', { action: 'Undo', onAction: async () => { await db.put(FILE, { ...cur }); ui.render(); } });
  });
  $('#fxAll', b)?.addEventListener('click', () => handOff(batchMsg(waiting), s, ui));
  $$('ul.fixes li[data-id]', b).forEach(li => (li.onclick = () => open(s, ui, { where, edit: li.dataset.id })));
  $('#fxLink', b)?.addEventListener('change', async e => {
    const st = await db.settings(); st.claudeLink = e.currentTarget.link.value.trim(); await db.saveSettings(st); s.claudeLink = st.claudeLink; ui.toast('Saved');
  });
  if (!cur) setTimeout(() => ta.focus(), 50);
}
