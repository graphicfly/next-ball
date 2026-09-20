import * as db from '../db.js';
import { qs, qsa, escapeHtml, trapSheetFocus } from '../ui.js';
import {
  CONTACTS, CONTACT_LABELS, PROX_BUCKETS, PROX_LABELS,
  MISS_DEPTH, MISS_LATERAL, MISS_LABELS, LEAVE_BUCKETS, LEAVE_LABELS, PACE, PACE_LABELS,
} from '../practice.js';

// Editing a rep that is already logged.
//
// Deliberately NOT the live canvas. Live logging commits on the first tap
// and advances; that is exactly wrong for a correction, where the golfer
// wants to see the current value, change one thing and confirm. Auto-advance
// in an editor would mean a mis-tap silently rewrote the record and closed.
//
// So this is a sheet: current values shown as selected, an explicit Save,
// and nothing commits until it is pressed.

function group(label, name, options, current) {
  return `
    <div class="setup-block">
      <div class="setup-label">${escapeHtml(label)}</div>
      <div class="pill-select" role="radiogroup" aria-label="${escapeHtml(label)}">
        ${options.map((o) => `
          <button type="button" class="pill ${o.value === current ? 'active' : ''}" role="radio"
                  aria-checked="${o.value === current}" data-name="${name}" data-value="${escapeHtml(String(o.value))}">
            ${escapeHtml(o.label)}
          </button>`).join('')}
      </div>
    </div>`;
}

export function openRepEditor(root, { kind, sessionId, record, onDone }) {
  const isChip = kind === 'chip';
  const draft = { ...record };

  const host = document.createElement('div');
  host.className = 'sheet-backdrop';
  host.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Edit previous">
      <div class="sheet-title">Edit previous ${isChip ? 'chip' : 'putt'}</div>
      <div class="sheet-body" id="editBody"></div>
      <div class="sheet-actions">
        <button class="btn btn-secondary" id="cancelEdit">Cancel</button>
        <button class="btn btn-primary" id="saveEdit">Save</button>
      </div>
    </div>`;
  root.appendChild(host);

  function body() {
    if (isChip) {
      return `
        ${group('Contact', 'contact', CONTACTS.map((c) => ({ value: c, label: CONTACT_LABELS[c] })), draft.contact)}
        ${draft.zone_hit != null ? group('Landing zone', 'zone_hit', [{ value: 'true', label: 'Hit' }, { value: 'false', label: 'Missed' }], String(draft.zone_hit)) : ''}
        ${group('How close', 'prox_bucket', PROX_BUCKETS.map((b) => ({ value: b, label: PROX_LABELS[b] })), draft.prox_bucket)}
        ${group('Depth', 'miss_depth', MISS_DEPTH.map((d) => ({ value: d, label: MISS_LABELS[d] })).concat([{ value: '', label: 'Not noted' }]), draft.miss_depth ?? '')}
        ${group('Direction', 'miss_lateral', MISS_LATERAL.map((d) => ({ value: d, label: MISS_LABELS[d] })).concat([{ value: '', label: 'Not noted' }]), draft.miss_lateral ?? '')}
        ${draft.putts != null ? group('Putts', 'putts', [0, 1, 2, 3].map((n) => ({ value: n, label: n === 3 ? '3+' : String(n) })), draft.putts) : ''}`;
    }
    return `
      ${group('Result', 'result', [{ value: 'made', label: 'Made' }, { value: 'missed', label: 'Missed' }], draft.result)}
      ${group('Leave', 'leave_bucket', LEAVE_BUCKETS.map((b) => ({ value: b, label: LEAVE_LABELS[b] })).concat([{ value: '', label: 'Not noted' }]), draft.leave_bucket ?? '')}
      ${group('Pace', 'leave_dir', PACE.map((p) => ({ value: p, label: PACE_LABELS[p] })).concat([{ value: '', label: 'Not noted' }]), draft.leave_dir ?? '')}
      ${group('Direction', 'miss_lateral', MISS_LATERAL.map((d) => ({ value: d, label: MISS_LABELS[d] })).concat([{ value: '', label: 'Not noted' }]), draft.miss_lateral ?? '')}
      ${group('Depth', 'miss_depth', MISS_DEPTH.map((d) => ({ value: d, label: MISS_LABELS[d] })).concat([{ value: '', label: 'Not noted' }]), draft.miss_depth ?? '')}`;
  }

  function drawBody() {
    qs('#editBody', host).innerHTML = body();
    qsa('.pill[data-name]', host).forEach((b) => {
      b.addEventListener('click', () => {
        const { name, value } = b.dataset;
        if (name === 'putts') draft[name] = Number(value);
        else if (name === 'zone_hit') draft[name] = value === 'true';
        else draft[name] = value === '' ? null : value;
        drawBody();
      });
    });
  }

  const close = () => { releaseFocus(); host.remove(); };
  const releaseFocus = trapSheetFocus(host, () => close());

  drawBody();
  qs('#cancelEdit', host).addEventListener('click', close);
  qs('#saveEdit', host).addEventListener('click', () => {
    // Updates the existing record. Never creates a second one — the id is
    // carried through untouched.
    if (isChip) db.updateChip(sessionId, record.chip_id, draft);
    else db.updatePutt(sessionId, record.putt_id, draft);
    close();
    onDone?.();
  });
}
