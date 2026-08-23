import * as db from '../db.js';
import { qs, qsa, cap, toast } from '../ui.js';
import { getDraft, setDraftField, clearDraft, getFlowReturn } from '../state.js';
import { disableWakeLock } from '../wakeLock.js';
import { stopWeatherTracking } from '../sessionWeather.js';

const ICON_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4"/><path d="M6 4.5h12l-3 4 3 4H6"/></svg>';

const STEPS = ['strike', 'direction', 'height', 'distance'];

const STEP_CONFIG = {
  strike: { title: 'Contact' },
  direction: { title: 'Direction' },
  height: { title: 'Height' },
  distance: { title: 'Distance' },
};

const OPTION_SELECTORS = {
  strike: '.strike-tile',
  direction: '.direction-zone',
  height: '.height-zone',
  distance: '.distance-zone',
};

// Direction — a three-wedge fan sharing one origin at the ball, replacing
// the old trident-on-a-ball graphic. Geometry is real trigonometry (see the
// comment above WEDGE_PATHS), not eyeballed: the outer rim is a true
// circular arc for the rounded dome silhouette, dividers are straight
// radii from the shared origin. Each wedge is its own tap target with the
// same data-value convention as every other shot-entry control. Each label
// sits just outside the dome, along the same angular ray as its own arrow
// (origin -> arrowhead extended past the rim), so it reads as sitting
// directly above that arrowhead rather than inside the busy wedge fill.
const FAN_ORIGIN = { x: 373.3, y: 430 };
const FAN_RIM = {
  outerLeft: '62,212',
  divLeftStraight: '237.1,75.2',
  divStraightRight: '509.5,75.2',
  outerRight: '684.6,212',
};
const WEDGE_PATHS = {
  left: `M373.3,430 L${FAN_RIM.outerLeft} A380,380 0 0,1 ${FAN_RIM.divLeftStraight} L373.3,430 Z`,
  straight: `M373.3,430 L${FAN_RIM.divLeftStraight} A380,380 0 0,1 ${FAN_RIM.divStraightRight} L373.3,430 Z`,
  right: `M373.3,430 L${FAN_RIM.divStraightRight} A380,380 0 0,1 ${FAN_RIM.outerRight} L373.3,430 Z`,
};
const ARROWS = {
  left: { shaft: 'M327.1,370.9 Q279.4,309.9 231.7,248.8', head: '219.4,233 239.6,242.6 223.8,255' },
  straight: { shaft: 'M373.3,355 L373.3,160', head: '373.3,134 386.3,160 360.3,160' },
  right: { shaft: 'M419.5,370.9 Q467.2,309.9 514.9,248.8', head: '527.2,233 522.8,255 507,242.6' },
};
const LABEL_POS = { left: '139,108', straight: '373.3,42', right: '608,108' };

function directionFanHtml(selected) {
  const hasSelection = !!selected;
  const wedgeHtml = (value, label) => `
    <g class="direction-zone${selected === value ? ' selected' : ''}" data-value="${value}" role="button" tabindex="0" aria-label="${label}">
      <path class="zone-fill" d="${WEDGE_PATHS[value]}" fill="url(#fanDepth)"></path>
      <path class="zone-border-glow" d="${WEDGE_PATHS[value]}" filter="url(#fanGlow)"></path>
      <path class="zone-border" d="${WEDGE_PATHS[value]}"></path>
      <path class="zone-arrow-shaft" d="${ARROWS[value].shaft}"></path>
      <polygon class="zone-arrowhead" points="${ARROWS[value].head}"></polygon>
      <text class="zone-label" x="${LABEL_POS[value].split(',')[0]}" y="${LABEL_POS[value].split(',')[1]}" text-anchor="middle">${label.toUpperCase()}</text>
    </g>`;

  return `
    <div class="direction-fan-wrap">
      <svg class="direction-fan ${hasSelection ? 'has-selection' : ''}" viewBox="0 0 747 560" role="img" aria-label="Shot direction">
        <defs>
          <radialGradient id="fanDepth" cx="50%" cy="100%" r="85%">
            <stop offset="0" stop-color="#171c20"></stop>
            <stop offset="1" stop-color="#0a0d10"></stop>
          </radialGradient>
          <filter id="fanGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="9"></feGaussianBlur>
          </filter>
          <mask id="photoMask">
            <circle cx="373.3" cy="455" r="104" fill="#fff"></circle>
          </mask>
        </defs>

        ${wedgeHtml('left', 'Left')}
        ${wedgeHtml('straight', 'Straight')}
        ${wedgeHtml('right', 'Right')}

        <image class="db-photo" href="graphics/direction/ball_grass.webp" x="269.3" y="351" width="208" height="208" preserveAspectRatio="xMidYMid slice" mask="url(#photoMask)"></image>
        <circle class="db-ring" cx="373.3" cy="455" r="104"></circle>
      </svg>
    </div>`;
}

// Height — a single photo (the teed ball at night) with three glowing
// trajectory arcs drawn on top as an SVG overlay. The overlay's viewBox
// matches the image's own pixel dimensions (900x950) and both layers use a
// centered-crop ("cover") fit, so the arcs stay pinned to the ball in the
// photo underneath no matter how the box gets cropped on a given screen.
// Medium carries a permanent accent gradient (the "ideal" option, same
// convention as Contact's solid tile); Low/High are plain solid strokes
// that swap to accent color via a CSS class on selection — never a
// gradient swap, which is the thing that's unreliable in Safari.
function heightSceneHtml(selected) {
  const hasSelection = !!selected;
  const zoneClass = (value) => `height-zone${selected === value ? ' selected' : ''}`;

  return `
    <div class="height-box">
      <img class="height-bg" src="graphics/height/height.webp" alt="" />
      <svg class="height-overlay ${hasSelection ? 'has-selection' : ''}" viewBox="0 0 900 950" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Shot height">
        <defs>
          <filter id="heightGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7"></feGaussianBlur>
          </filter>
        </defs>

        <g class="${zoneClass('low')}" data-value="low">
          <rect class="hz-hit" x="0" y="0" width="370" height="950" fill="transparent"></rect>
          <path class="hz-glow" d="M450,690 Q380,530 322,545" filter="url(#heightGlow)"></path>
          <path class="hz-line" d="M450,690 Q380,530 322,545"></path>
          <circle class="hz-dot" cx="322" cy="545" r="6"></circle>
          <text class="hz-title" x="290" y="460" text-anchor="middle">LOW</text>
          <text class="hz-subtitle" x="290" y="483" text-anchor="middle">Line drive</text>
        </g>

        <g class="${zoneClass('medium')}" data-value="medium">
          <rect class="hz-hit" x="370" y="0" width="160" height="950" fill="transparent"></rect>
          <path class="hz-glow" d="M450,690 Q432,540 450,384" filter="url(#heightGlow)"></path>
          <path class="hz-line" d="M450,690 Q432,540 450,384"></path>
          <circle class="hz-dot" cx="450" cy="384" r="6"></circle>
          <text class="hz-title" x="418" y="305" text-anchor="middle">MEDIUM</text>
          <text class="hz-subtitle" x="418" y="328" text-anchor="middle">Ideal iron flight</text>
        </g>

        <g class="${zoneClass('high')}" data-value="high">
          <rect class="hz-hit" x="530" y="0" width="370" height="950" fill="transparent"></rect>
          <path class="hz-glow" d="M450,690 Q449,435 596,228" filter="url(#heightGlow)"></path>
          <path class="hz-line" d="M450,690 Q449,435 596,228"></path>
          <circle class="hz-dot" cx="596" cy="228" r="6"></circle>
          <text class="hz-title" x="566" y="151" text-anchor="middle">HIGH</text>
          <text class="hz-subtitle" x="566" y="174" text-anchor="middle">Towering shot</text>
        </g>
      </svg>
    </div>`;
}

// Distance — a downrange photo (scene only, no text/rings baked in — those
// need to be dynamic) with seven full-width tap bands stacked in
// perspective: closer distances are lower, larger, and more spaced out;
// farther ones rise, shrink, and compress toward the vanishing point, same
// depth cue as the reference. Only the selected rung gets the pill+glow
// treatment — every other value stays plain text, which is what keeps the
// target rings "sparse" rather than cluttering every rung.
// Kept compact (spanning well under the full 1400-tall viewBox) even
// though there's plenty of vertical room in a typical container — the
// overlay uses a top-anchored crop (see distanceLadderHtml) so the ball at
// the very bottom of the photo is the first thing sacrificed on a short
// screen, never one of the seven numbers. y=880 for the closest rung
// leaves that margin even on the shortest iPhone.
const FULL_DISTANCE_RUNGS = [
  { value: '200+', y: 40, size: 44 },
  { value: '175', y: 117, size: 54 },
  { value: '150', y: 239, size: 66 },
  { value: '125', y: 379, size: 78 },
  { value: '100', y: 530, size: 90 },
  { value: '75', y: 694, size: 96 },
  { value: '50', y: 863, size: 104 },
];

// Half and 3/4 offer more preset values than Full (10 and 8 vs 7), so they
// can't reuse Full's hand-placed y/size numbers as-is without either
// crowding the extra rungs together unreadably or spilling past the
// screen. This generates positions/sizes for any count using the same
// "farther = smaller, higher, more compressed together; closer = bigger,
// lower, more spread out" perspective curve Full's own hand-tuned numbers
// already follow (topY/bottomY match Full's own top and bottom rungs, so
// the closest and farthest points of the ladder feel consistent across all
// three swing lengths) — Full itself keeps its exact original array above
// rather than being regenerated, so its screen is pixel-identical to
// before this change.
function buildPerspectiveRungs(values, { minSize, maxSize = 104, topY = 40, bottomY = 863, curve = 1.28 }) {
  const n = values.length;
  return values.map((value, i) => {
    const t = n > 1 ? i / (n - 1) : 1;
    const eased = t ** curve;
    return {
      value,
      y: Math.round(topY + eased * (bottomY - topY)),
      size: Math.round(minSize + eased * (maxSize - minSize)),
    };
  });
}

// Farthest-to-closest order (matches Full's own array) — the ladder photo
// is a downrange perspective shot, so the largest yardage sits at the top
// (farthest into the photo) and the smallest at the bottom (closest to the
// golfer), regardless of which swing length's list is showing.
const RUNGS_BY_SWING = {
  full: FULL_DISTANCE_RUNGS,
  // topY/minSize pinned to exactly where "60" used to render as the topmost
  // item's own slot (the default topY=40/minSize=34 curve's i=1 position for
  // this same 7-value list) — pulls "75" down into that spot rather than
  // sitting at the very top of the box, compressing the whole ladder
  // downward to match.
  half: buildPerspectiveRungs([...db.DISTANCE_PRESETS_BY_SWING.half].reverse(), { topY: 123, minSize: 41 }),
  'three-quarter': buildPerspectiveRungs([...db.DISTANCE_PRESETS_BY_SWING['three-quarter']].reverse(), { minSize: 40 }),
};

function rungsForSwing(swingLength) {
  return RUNGS_BY_SWING[swingLength] || FULL_DISTANCE_RUNGS;
}

function distanceLadderHtml(selected, swingLength) {
  const hasSelection = !!selected;
  const rungs = rungsForSwing(swingLength);

  const rungsHtml = rungs.map((rung, i) => {
    const prev = rungs[i - 1];
    const next = rungs[i + 1];
    const top = prev ? (prev.y + rung.y) / 2 : rung.y - 120;
    const bottom = next ? (rung.y + next.y) / 2 : rung.y + 150;
    const isSelected = selected === rung.value;
    const pillW = rung.size * 2.3;
    const pillH = rung.size * 1.5;

    return `
      <g class="distance-zone${isSelected ? ' selected' : ''}" data-value="${rung.value}">
        <rect class="dz-hit" x="0" y="${top}" width="900" height="${bottom - top}" fill="transparent"></rect>
        ${isSelected ? `
          <ellipse class="dz-ring" cx="450" cy="${rung.y - rung.size * 0.15}" rx="${rung.size * 3.6}" ry="${rung.size * 1.3}" filter="url(#distanceGlow)"></ellipse>
          <rect class="dz-pill-glow" x="${450 - pillW / 2}" y="${rung.y - pillH * 0.7}" width="${pillW}" height="${pillH}" rx="${pillH * 0.3}" filter="url(#distanceGlow)"></rect>
          <rect class="dz-pill" x="${450 - pillW / 2}" y="${rung.y - pillH * 0.7}" width="${pillW}" height="${pillH}" rx="${pillH * 0.3}"></rect>
        ` : ''}
        <text class="dz-text${isSelected ? ' selected' : ''}" x="450" y="${rung.y}" font-size="${rung.size}" text-anchor="middle">${rung.value}</text>
      </g>`;
  }).join('');

  return `
    <div class="distance-box">
      <img class="distance-bg" src="graphics/distance/distance_ladder.webp" alt="" />
      <svg class="distance-overlay ${hasSelection ? 'has-selection' : ''}" viewBox="0 0 900 1400" preserveAspectRatio="xMidYMin slice" role="img" aria-label="Shot distance">
        <defs>
          <filter id="distanceGlow" x="-100%" y="-140%" width="300%" height="380%">
            <feGaussianBlur stdDeviation="20"></feGaussianBlur>
          </filter>
        </defs>
        ${rungsHtml}
      </svg>
    </div>
    <button class="btn btn-outline distance-custom-btn" id="enterCustomBtn">Enter Custom</button>`;
}

// Contact's illustrated tile grid — one rendered photo per outcome
// (bundled locally, never fetched remotely) instead of a generated SVG
// scene. The trajectory glow is baked into each image now, so this is just
// layout: which file goes with which strike value.
const STRIKE_TILE_ORDER = ['solid', 'thin', 'topped', 'fat', 'shank', 'miss'];

function strikeTileGridHtml(selected) {
  return `
    <div class="strike-tile-grid">
      ${STRIKE_TILE_ORDER.map((type) => {
        const isSelected = selected === type;
        const positive = type === 'solid' && !isSelected ? ' positive' : '';
        return `
          <div class="strike-tile${isSelected ? ' selected' : ''}${positive}" data-value="${type}">
            <div class="strike-tile-illustration">
              <img src="graphics/direction/strike_${type}.webp" alt="" loading="lazy" />
            </div>
            <div class="strike-tile-label">${cap(type)}</div>
          </div>`;
      }).join('')}
    </div>`;
}

export function renderShotEntry(root, step) {
  const draft = getDraft();
  // A new shot needs the active session (to stamp its current club/setup/swing).
  // Editing an existing shot needs no active session — it may belong to a
  // finished session reached from History.
  const session = draft.mode === 'edit' ? null : db.getActiveSession();
  if (draft.mode !== 'edit' && !session) { location.hash = '#/home'; return; }

  // Independent of `session` above (which is deliberately null in edit
  // mode) — this just answers "is there a session to end from here at
  // all," which is true whether the golfer is mid-new-shot or editing a
  // past shot from an in-progress session's history.
  const activeSession = db.getActiveSession();

  const config = STEP_CONFIG[step];
  const stepIndex = STEPS.indexOf(step);
  const selectedValue = step === 'distance'
    ? (draft.distance_yards !== undefined ? db.yardsToDistanceLabel(draft.distance_yards) : null)
    : draft[step];

  let bodyHtml;
  if (step === 'strike') {
    bodyHtml = `
      <div class="strike-header">
        <div class="strike-heading">Contact</div>
        <div class="strike-subheading">How did you catch it?</div>
      </div>
      ${strikeTileGridHtml(selectedValue)}`;
  } else if (step === 'direction') {
    bodyHtml = `
      <div class="strike-header">
        <div class="strike-heading">Direction</div>
        <div class="strike-subheading">Where did it go?</div>
      </div>
      ${directionFanHtml(selectedValue)}`;
  } else if (step === 'height') {
    bodyHtml = `
      <div class="strike-header">
        <div class="strike-heading">Height</div>
        <div class="strike-subheading">How high did it fly?</div>
      </div>
      ${heightSceneHtml(selectedValue)}`;
  } else {
    // New shot: the active session's CURRENT swing setting, re-read fresh
    // on every render — so changing it (Active screen's Settings sheet)
    // before tapping Log Shot is picked up automatically. Editing: the
    // shot's own immutable swing_length captured once at edit-start (see
    // state.js) — never the session's current setting, which could have
    // changed since that shot was originally logged.
    const swingLength = draft.mode === 'edit' ? draft.swing_length : session.current_swing;
    bodyHtml = `
      <div class="strike-header">
        <div class="strike-heading">Distance</div>
        <div class="strike-subheading">How far did it go?</div>
      </div>
      ${distanceLadderHtml(selectedValue, swingLength)}`;
  }

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="back" id="cancelBtn">Cancel</button>
        <span class="screen-title">${config.title}</span>
        <div class="topbar-actions">
          <span class="step">${stepIndex + 1}/4</span>
          ${activeSession ? `<button class="icon-btn" id="endSessionBtn" aria-label="End Session">${ICON_FLAG}</button>` : ''}
        </div>
      </div>
      ${bodyHtml}
    </div>
  `;

  qs('#cancelBtn', root).addEventListener('click', () => {
    clearDraft();
    location.hash = getFlowReturn();
  });

  qs('#endSessionBtn', root)?.addEventListener('click', () => {
    // Same underlying action as Active Session's End Session — no
    // confirmation step, matching that screen. Whatever shot was mid-entry
    // is discarded, same as Cancel; there's no partial-shot save to lose.
    clearDraft();
    db.finishSession(activeSession.session_id);
    disableWakeLock();
    stopWeatherTracking();
    location.hash = `#/checkin/${activeSession.session_id}`;
  });

  qs('#enterCustomBtn', root)?.addEventListener('click', () => openCustomDistanceSheet(session, draft, root));

  const selectOption = (value) => {
    // Mark the tapped option selected immediately so its "touched" color
    // (e.g. Direction's arrow turning green) actually gets a frame to paint
    // before the screen moves on — advancing straight to the next hash left
    // no time for it to ever be seen.
    qsa(OPTION_SELECTORS[step], root).forEach((el) => {
      el.classList.toggle('selected', el.dataset.value === value);
    });

    setTimeout(() => {
      if (step === 'strike' && value === 'miss') {
        // A whiff has no direction, height, or distance to record — skip
        // straight to save so the next ball can be teed up immediately.
        setDraftField('strike', 'miss');
        draft.direction = null;
        draft.height = null;
        draft.distance_yards = null;
        finishShot(session, draft, root);
        return;
      }
      if (step === 'distance') {
        setDraftFieldDistance(draft, value);
        finishShot(session, draft, root);
      } else {
        setDraftField(step, value);
        const nextStep = STEPS[stepIndex + 1];
        location.hash = `#/log/${nextStep}`;
      }
    }, 180);
  };

  qsa(OPTION_SELECTORS[step], root).forEach((btn) => {
    btn.addEventListener('click', () => selectOption(btn.dataset.value));
    // Direction's zones are SVG <g role="button"> elements — real keyboard
    // activation (Enter/Space) isn't automatic for those the way it is for
    // an actual <button>, so it's wired explicitly here. Harmless no-op for
    // the other steps' elements, which aren't focusable anyway.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectOption(btn.dataset.value); }
    });
  });
}

function setDraftFieldDistance(draft, label) {
  draft.distance_yards = db.distanceLabelToYards(label);
}

// The ladder only offers seven coarse buckets — this is the escape hatch
// for an exact yardage, storing the typed number directly with no bucket
// conversion so it round-trips precisely through yardsToDistanceLabel.
function openCustomDistanceSheet(session, draft, root) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet">
      <h2>Custom Distance</h2>
      <div class="field">
        <label>Yards</label>
        <input type="number" id="customDistanceInput" inputmode="numeric" pattern="[0-9]*" placeholder="Yards" min="1" max="400" />
      </div>
      <button class="btn btn-primary" id="saveCustomDistanceBtn" style="margin-top:8px;">Save</button>
      <button class="btn btn-outline" id="closeCustomDistanceBtn" style="margin-top:8px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  qs('#closeCustomDistanceBtn', backdrop).addEventListener('click', () => backdrop.remove());

  const input = qs('#customDistanceInput', backdrop);
  input.focus();

  const save = () => {
    const value = Number(input.value);
    if (!value || value < 1) { toast('Enter a valid distance'); return; }
    draft.distance_yards = Math.round(value);
    backdrop.remove();
    finishShot(session, draft, root);
  };

  qs('#saveCustomDistanceBtn', backdrop).addEventListener('click', save);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

function finishShot(session, draft, root) {
  if (draft.mode === 'edit') {
    db.updateShot(draft.sessionId, draft.shotId, {
      strike: draft.strike,
      direction: draft.direction,
      height: draft.height,
      distance_yards: draft.distance_yards,
    });
  } else {
    db.addShot(session.session_id, {
      club: session.current_club,
      setup: session.current_setup,
      surface: session.current_surface,
      swing_length: session.current_swing,
      drill: session.current_drill,
      target_distance_yards: session.current_target_distance,
      training_aid: session.current_training_aid,
      strike: draft.strike,
      direction: draft.direction,
      height: draft.height,
      distance_yards: draft.distance_yards,
    });
  }
  const returnTo = getFlowReturn();
  clearDraft();
  showSavedFlash(() => { location.hash = returnTo; });
}

function showSavedFlash(callback) {
  // A brief tick on save, mirroring the visual confirmation — never throws
  // on browsers without the Vibration API (notably iOS Safari).
  if (navigator.vibrate) navigator.vibrate(15);

  let node = document.getElementById('savedFlash');
  if (!node) {
    node = document.createElement('div');
    node.id = 'savedFlash';
    node.className = 'saved-flash';
    node.innerHTML = '<div class="txt">&#10003; Saved</div>';
    document.body.appendChild(node);
  }
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    callback();
  }, 380);
}
