# Technical spikes

Feasibility prototypes. **Not part of the Next Ball application** — no shared code,
no shared storage, no navigation into or out of them. Each is safe to delete.

## `swing/` — Swing Lab local pipeline (V4.3)

Answers one question: *can an ordinary iPhone golf swing video be imported, stored,
decoded frame-by-frame and pose-analysed entirely on the device?*

Open **/spike/swing/** on the target phone, work down the page, then copy the report
JSON at the bottom.

It writes only to its own IndexedDB database (`nextball_spike_media`) and never touches
`localStorage`, so it cannot affect real sessions, rounds or lessons. "Reset spike data"
removes everything it created.

`/spike/` is excluded from the service worker's app-shell cache, so a test phone always
gets the current build rather than the first one it saw.
