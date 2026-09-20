import { escapeHtml } from '../ui.js';
import { PROX_BUCKETS, PROX_LABELS, LEAVE_BUCKETS, LEAVE_LABELS } from '../practice.js';

// The spatial result canvases shared by Chipping and Putting.
//
// One rule drives every one of them: the primary result is ONE TAP, and the
// tap is on a picture of where the ball finished rather than on a word in a
// list. The golfer is standing up, outdoors, wearing a glove, giving the
// phone about a second of attention.
//
// These are markup builders only — no storage, no state. The session screens
// own what a tap means.

// Concentric proximity rings for chipping.
//
// Drawn LARGEST FIRST so each smaller circle paints over the middle of the
// one before it. A tap in the 6-10 band therefore lands on the r=124 circle,
// because the r=94 circle does not reach there — which gives correct hit
// testing from six plain filled circles and no path arithmetic.
//
// Bands widen inward: the buckets the golfer cares most about (holed, inside
// three feet) get the largest targets, and a mis-tap lands in an adjacent
// bucket rather than somewhere meaningless.
const RINGS = [
  { bucket: '20_plus', r: 175 },
  { bucket: '10_20', r: 152 },
  { bucket: '6_10', r: 124 },
  { bucket: '3_6', r: 94 },
  { bucket: 'in_3', r: 62 },
  { bucket: 'holed', r: 30 },
];

export function proximityTargetHtml() {
  const cx = 180, cy = 180;
  const labelFor = (bucket, r, prev) => {
    // Sits in the middle of the band, on the vertical axis above centre.
    const mid = prev == null ? 0 : (r + prev) / 2;
    return { x: cx, y: cy - mid + 5 };
  };
  let prev = null;
  const labels = [];
  for (let i = RINGS.length - 1; i >= 0; i--) {
    const { bucket, r } = RINGS[i];
    const pos = labelFor(bucket, r, prev);
    labels.push({ bucket, ...pos });
    prev = r;
  }

  return `
    <svg class="prox-target" viewBox="0 0 360 360" role="group" aria-label="How close did it finish?">
      ${RINGS.map(({ bucket, r }) => `
        <circle class="prox-zone" data-bucket="${bucket}" cx="${cx}" cy="${cy}" r="${r}">
          <title>${escapeHtml(PROX_LABELS[bucket])}</title>
        </circle>`).join('')}
      ${labels.map(({ bucket, x, y }) => `
        <text class="prox-label ${bucket === 'holed' ? 'is-holed' : ''}" x="${x}" y="${y}"
              data-bucket="${bucket}" text-anchor="middle">${escapeHtml(shortLabel(bucket))}</text>`).join('')}
      <circle class="prox-ball" cx="${cx}" cy="${cy}" r="0" />
    </svg>`;
}

function shortLabel(bucket) {
  return { holed: 'HOLED', in_3: '3 ft', '3_6': '3–6', '6_10': '6–10', '10_20': '10–20', '20_plus': '20+' }[bucket] || bucket;
}

// Short putting: a 3x3 grid with the cup in the middle.
//
// A grid rather than wedges, because these are the largest targets a phone
// can give — roughly a third of the screen each — and the arrangement is
// still spatial: Long is beyond the hole, Short is in front of it, Left and
// Right are to the sides. Made is the centre and the biggest thing on
// screen, because most putts in short-putt practice go in.
export function puttTargetHtml() {
  const cell = (id, label, axis, value, cls = '') => `
    <button class="putt-cell ${cls}" data-result="${id}" ${axis ? `data-axis="${axis}" data-value="${value}"` : ''}>
      <span>${escapeHtml(label)}</span>
    </button>`;

  return `
    <div class="putt-grid" role="group" aria-label="Where did the putt finish?">
      <div class="putt-spacer"></div>
      ${cell('miss', 'Long', 'miss_depth', 'long')}
      <div class="putt-spacer"></div>
      ${cell('miss', 'Left', 'miss_lateral', 'left')}
      ${cell('made', 'Made', null, null, 'is-made')}
      ${cell('miss', 'Right', 'miss_lateral', 'right')}
      <div class="putt-spacer"></div>
      ${cell('miss', 'Short', 'miss_depth', 'short')}
      <div class="putt-spacer"></div>
    </div>`;
}

// Distance control: proximity and pace in one tap (practice-spec.md §16).
//
// Laid out as the hole with bands in front of and beyond it, so "past" is
// genuinely above and "short" genuinely below. One cell carries both facts.
export function lagTargetHtml() {
  const row = (bucket, dir) => `
    <button class="lag-cell" data-bucket="${bucket}" data-dir="${dir}">
      <span class="lag-cell-bucket">${escapeHtml(LEAVE_LABELS[bucket])}</span>
    </button>`;

  const past = [...LEAVE_BUCKETS].reverse();
  return `
    <div class="lag-target" role="group" aria-label="Where did it finish?">
      <div class="lag-side-label">Past</div>
      ${past.map((b) => row(b, 'past')).join('')}
      <button class="lag-holed" data-holed="1"><span>Holed</span></button>
      ${LEAVE_BUCKETS.map((b) => row(b, 'short')).join('')}
      <div class="lag-side-label">Short</div>
    </div>`;
}

// Two outsized choices, for Landing Zone and Pressure Finish.
export function binaryTargetHtml(a, b) {
  return `
    <div class="binary-target">
      <button class="binary-cell is-good" data-choice="${a.value}"><span>${escapeHtml(a.label)}</span></button>
      <button class="binary-cell" data-choice="${b.value}"><span>${escapeHtml(b.label)}</span></button>
    </div>`;
}

// Up & Down's second step, shown in place of the target on the same screen.
export function puttsStepHtml() {
  return `
    <div class="binary-target putts-step" role="group" aria-label="Putts to hole out">
      <div class="putts-step-label">Putts to hole out</div>
      <div class="putts-step-row">
        ${[1, 2, 3].map((n) => `<button class="binary-cell" data-putts="${n}"><span>${n === 3 ? '3+' : n}</span></button>`).join('')}
      </div>
    </div>`;
}

// The count, read as balls COMPLETED out of balls planned.
export function progressHeadHtml({ done, target, context, streak = null }) {
  return `
    <div class="practice-head">
      <div class="practice-count"><span class="practice-count-done">${done}</span><span class="practice-count-sep"> / </span><span class="practice-count-target">${target}</span></div>
      ${streak ? `<div class="practice-streak">${escapeHtml(streak)}</div>` : ''}
      <div class="practice-head-context">${escapeHtml(context)}</div>
    </div>`;
}
