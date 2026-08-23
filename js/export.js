import { getSession, getShotsForSession, listSessions, getAllShots, exportFullDB, importFullDB, yardsToDistanceLabel, sessionDataSource, shotTrainingAid, sessionLocationSource } from './db.js';
import { focusList } from './ui.js';

// Precise lat/lon is deliberately NOT exported to CSV — it wasn't in this
// export before, and a CSV is exactly the kind of file a golfer might casually
// share or back up; location_city/location_state/location_source give the
// useful metadata without adding raw GPS to a shareable file. Full JSON
// backups already include latitude/longitude on the session record (as they
// always have) — this is a CSV-specific, privacy-conscious choice, not a
// gap in the data model.
const CSV_HEADERS = [
  'session_id', 'data_source', 'date', 'start_time', 'location', 'location_city', 'location_state', 'location_source',
  'temperature_f', 'feels_like_f', 'humidity_percent', 'weather_condition', 'precipitation', 'cloud_cover_percent',
  'wind_speed_mph', 'wind_gust_mph', 'wind_direction_degrees', 'wind_direction_cardinal', 'weather_timestamp',
  'fatigue_rating', 'hand_discomfort_rating', 'elbow_discomfort_rating',
  'practice_focus', 'shot_timestamp', 'shot_number', 'club', 'setup', 'surface', 'swing_length', 'drill', 'training_aid',
  'target_distance_yards', 'strike', 'direction', 'height', 'distance_yards',
];

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function shotToRow(session, shot) {
  return [
    session.session_id,
    sessionDataSource(session),
    session.date,
    session.start_time,
    session.location_name || '',
    session.location_city || '',
    session.location_state || '',
    sessionLocationSource(session),
    session.temperature_f ?? '',
    session.feels_like_f ?? '',
    session.humidity_percent ?? '',
    session.weather_condition || '',
    session.precipitation ?? '',
    session.cloud_cover_percent ?? '',
    session.wind_speed_mph ?? '',
    session.wind_gust_mph ?? '',
    session.wind_direction_degrees ?? '',
    session.wind_direction_cardinal || '',
    session.weather_timestamp || '',
    session.fatigue_rating ?? '',
    session.hand_discomfort_rating ?? '',
    session.elbow_discomfort_rating ?? '',
    focusList(session.practice_focus).join(', '),
    shot.shot_timestamp || '',
    shot.shot_number,
    shot.club,
    shot.setup,
    shot.surface || '',
    shot.swing_length,
    shot.drill || '',
    shotTrainingAid(shot),
    shot.target_distance_yards ?? '',
    shot.strike,
    shot.direction,
    shot.height,
    yardsToDistanceLabel(shot.distance_yards),
  ];
}

function buildCSV(rows) {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\n');
}

export function sessionCSV(sessionId) {
  const session = getSession(sessionId);
  if (!session) return '';
  const shots = getShotsForSession(sessionId);
  return buildCSV(shots.map((sh) => shotToRow(session, sh)));
}

export function allShotsCSV() {
  const sessions = listSessions();
  const byId = Object.fromEntries(sessions.map((s) => [s.session_id, s]));
  const shots = getAllShots()
    .filter((sh) => byId[sh.session_id])
    .sort((a, b) => {
      const sa = byId[a.session_id], sb = byId[b.session_id];
      const createdCmp = (sa.created_at || '').localeCompare(sb.created_at || '');
      if (createdCmp !== 0) return createdCmp;
      return a.shot_number - b.shot_number;
    });
  return buildCSV(shots.map((sh) => shotToRow(byId[sh.session_id], sh)));
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadSessionCSV(sessionId) {
  const session = getSession(sessionId);
  download(`nextball_session_${session?.date || 'export'}.csv`, sessionCSV(sessionId), 'text/csv');
}

export function downloadAllCSV() {
  download(`nextball_all_shots_${new Date().toISOString().slice(0, 10)}.csv`, allShotsCSV(), 'text/csv');
}

export function downloadJSONBackup() {
  const data = exportFullDB();
  download(`nextball_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
}

export function importJSONBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        importFullDB(obj);
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
