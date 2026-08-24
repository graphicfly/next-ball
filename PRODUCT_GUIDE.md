# NEXT BALL — PRODUCT GUIDE

## 1. Product Purpose

Next Ball is a mobile-first golf practice app designed to help golfers:

- log every range shot quickly
- understand contact and consistency
- identify meaningful practice patterns
- compare sessions over time
- understand what drills/training aids may correlate with better outcomes
- build a repeatable practice habit

The app should feel like an athletic training tool, not a spreadsheet or analytics dashboard.

Core product philosophy:

Practice -> Log -> Understand -> Improve -> Return

The logging experience must disappear into the practice session rather than interrupt it.

---

## 2. Product Principles

### Fast
Normal shot logging should require only a few taps.

Standard flow:

Log Shot
-> Contact
-> Direction
-> Height
-> Distance
-> automatically save
-> return to Active Session

No unnecessary confirmation steps.

### Visual
Prefer visual selection over form controls.

Examples:

- illustrated Contact tiles
- Direction fan
- trajectory visualization
- range-based distance ladder
- shot map on Session Recap

### Progressive Disclosure
Do not show every analytic at once.

Session Recap:
What should I know right now?

Explore Session:
Show me more.

Settings/details should remain one level deeper when possible.

### Data Must Be Trustworthy
The app is only useful if the recorded data reflects what actually happened.

Session state acts as defaults.

Each saved shot is a historical snapshot.

Changing:

- club
- training aid
- drill
- target
- swing length
- setup
- surface

must only affect subsequent shots.

Never retroactively modify previous shots unless the user explicitly edits them.

### Real Use Drives Features
Prioritize problems discovered during actual range use over speculative features.

---

## 3. Brand

Product name:

NEXT BALL

Tagline:

Find your groove.

Primary domain:

nextballgolf.com

Brand tone:

- athletic
- premium
- modern
- concise
- confident
- useful
- not overly playful
- not gamified

Avoid:

- fake motivational praise
- excessive trophies/confetti
- XP systems
- arcade aesthetics
- golf clichés
- skeuomorphic grass/golf textures

---

## 4. Visual Language

Primary visual style:

- near-black / charcoal backgrounds
- Next Ball bright green accent
- white primary typography
- cool gray secondary text
- generous negative space
- large touch targets
- restrained rounded cards
- subtle dark golf-range atmosphere
- very limited semantic amber/red

Green should represent:

- selected state
- Solid contact
- meaningful improvement
- primary CTA

Amber should represent:

- Thin
- Topped
- Fat
- caution/pattern insight

Red should represent:

- Shank
- Miss
- destructive actions

Do not color every statistic.

---

## 5. Mobile / PWA Priority

Next Ball is designed primarily for:

- iPhone
- portrait orientation
- installed PWA use
- one-handed operation
- outdoor/range use

Requirements:

- respect safe areas
- large tap targets
- readable outdoors
- offline-friendly
- local assets
- no unnecessary remote dependencies
- preserve state across reload/resume

---

## 6. Session Setup

The Session Setup screen should use:

COMMON CHOICES FIRST
FULL CHOICES SECOND

Core settings:

- Club
- Ball Count
- Surface
- Lie / Setup
- Swing Length

Secondary settings:

- Drill
- Training Aid
- Target Practice

The app should remember appropriate values from recent REAL sessions.

Test/simulated sessions must not influence personalization.

### Club Quick Picks

Show approximately four quick-access clubs plus:

More >

Quick clubs should be determined by:

- frequency
- recency
- stability

Do not constantly reorder them.

A currently selected club must remain visible even if it came from More.

### Ball Count

Use common quick picks plus:

Custom >

Custom/common counts may become quick picks over time.

### Target Practice

Target is optional.

Do not emphasize Target when inactive.

A new session should generally default Target to Off unless explicitly designed otherwise.

---

## 7. Active Session

The Active Session hierarchy is:

1. progress / current ball
2. club / lie / surface / swing
3. Practice Setup
4. Log Shot
5. Undo / Edit Previous
6. Pause / End

LOG SHOT is the dominant action.

### Practice Setup

Do not use separate large cards for:

- Drill
- Target
- Training Aid

Use one conditional Practice Setup row.

Examples:

Normal Swing

Low Point

Low Point · Connection Ball

Low Point · Strike Wedge

Low Point · Strike Wedge · 50 yd Target

Rules:

- Drill is shown as base context.
- Training Aid appears only when active.
- Target appears only when active.
- Never show "No Target" or "No Training Aid" on the primary screen.

Tap Practice Setup to edit those values.

---

## 8. Mid-Session Changes

The golfer can change practice context during a session.

Club must be changeable without restarting the session.

Training Aid must be turnable on and off.

Supported Training Aids currently include:

- None
- Connection Ball
- Strike Wedge
- Alignment Stick
- Divot Board
- Other

Drill and Training Aid are independent concepts.

Example:

Drill:
Low Point

Training Aid:
Strike Wedge

is valid.

Each saved shot must preserve the context that was active at that moment.

---

## 9. Shot Data Model Philosophy

A session is the practice container.

A shot is the historical truth.

Shot-level context should include where supported:

- shot number
- timestamp
- club
- setup / lie
- surface
- swing length
- drill
- training aid
- target distance
- strike
- direction
- height
- distance

Exports and analytics should prefer shot-level values rather than final session state.

---

## 10. Contact

Supported contact states:

- Solid
- Thin
- Topped
- Fat
- Shank
- Miss

Contact should be visual and fast.

Do not convert Contact into generic rectangular form buttons.

---

## 11. Direction

Values:

- Left
- Straight
- Right

Use the three-zone visual fan with a common golf-ball origin.

The entire zone is tappable.

Selected direction uses the Next Ball green treatment.

---

## 12. Height

Values:

- Low
- Medium
- High

Use a visual trajectory interaction rather than plain text buttons.

---

## 13. Distance

Distance presets depend on Swing Length.

### Half

5
10
15
20
25
30
40
50
60
75

### Three-Quarter

25
40
50
60
75
90
100
125

### Full

50
75
100
125
150
175
200+

Always keep:

ENTER CUSTOM

The stored numeric distance should remain compatible across all swing types.

---

## 14. Session Recap

The recap is a REWARD, not an analytics report.

It should answer:

- How did I do?
- What stood out?
- What does the session look like?
- What can I aim for next?

Current structure:

1. session metadata
2. visual Solid Contact hero
3. Straight + Median Solid
4. one meaningful insight if available
5. Your Session shot map
6. Next Goal if eligible
7. Explore Session
8. Done

Do not add additional analytics cards unless clearly justified.

---

## 15. Solid Contact Hero

Solid Contact is the primary recap metric.

Use a large circular progress visualization.

The ring represents actual Solid %.

Inside:

percentage
SOLID CONTACT

A comparison pill may appear when a meaningful comparable-session change exists.

Do not duplicate the same comparison again in the insight card.

---

## 16. Session Insights

Show at most ONE primary insight on the Recap.

Insights must be deterministic and grounded in real data.

Useful categories include:

- Personal Best
- meaningful comparison improvement
- cleaner contact
- strong finish
- meaningful streak
- consistency improvement
- target improvement
- useful practice pattern

Avoid:

- generic praise
- restating hero metrics
- fake AI coaching
- mechanical swing diagnosis

If no useful insight exists:

hide the insight card.

---

## 17. Short Sessions

Adaptive shot-map behavior:

1–5 shots:
large markers, numbering acceptable

6–10:
medium-large

11–20:
medium

21+:
compact grid

50 shots:
5 rows x 10 columns

Never render empty-looking placeholders.

If a session contains N shots, exactly N markers must render.

---

## 18. Your Session Shot Map

Strike encoding should use both shape and color.

Solid:
green filled circle

Thin:
amber outlined circle

Topped:
amber mark

Fat:
amber rounded square

Shank:
red triangle

Miss:
red X

Legend only shows categories that occurred.

Best 10 highlighting should use the actual rolling Best 10 window.

---

## 19. Next Goal

Next Goal is already implemented.

It only appears for sessions with 10 or more shots.

Purpose:

turn one practice session into an achievable reason to return.

Goals are deterministic.

One goal maximum.

Goal examples:

- 60% Solid Contact
- Top + Fat under 20%
- 80% Straight
- 10 Solid in a Row
- target accuracy milestone

No mechanical advice.

No goal for sessions under 10 shots.

Do not place Next Goal inside Explore Session.

---

## 20. Explore Session

Explore Session means:

Show me more.

It should not mean:

Show me everything at once.

Use four primary accordion sections:

1. Performance
2. Session Flow
3. Practice
4. Conditions

Initial state:

all collapsed

Prefer one expanded section at a time.

### Performance

Collapsed example:

57% Solid · 57% Straight · 40 yd Median

Expanded content may include:

- Contact
- Direction
- Distance
- Trajectory
- Consistency

### Session Flow

Collapsed example:

Finished stronger · 70% Solid in last 10

Expanded content may include:

- First vs Last
- Best Stretch
- streaks
- shot progression

Hide analytics that are unavailable.

Do not show large "not enough shots" placeholders.

### Practice

Collapsed example:

7i + PW · Low Point · Strike Wedge

Expanded:

- Club
- Drill
- Training Aid
- Target
- Surface
- Setup
- Swing

Use actual shot-level values.

### Conditions

Collapsed example:

Reston National · 72°F · Fatigue 2/5

Expanded:

- venue
- weather
- wind
- fatigue
- hand discomfort
- elbow discomfort
- duration

Conditions remain visually secondary.

---

## 21. History

History should accurately represent mixed-club sessions.

If two clubs were used, prefer:

7i + PW

rather than incorrectly labeling the entire session as one club.

Individual sessions must be deletable.

Deleting one session must not affect others.

---

## 22. Real vs Test Data

Sessions should support a source distinction such as:

real
test

Normal user-created sessions:

real

Simulated/development sessions:

test

Test data must not influence:

- personalized club choices
- remembered setup
- real trends
- Personal Best
- Next Goal history

Provide safe mechanisms to remove test sessions.

---

## 23. Location

Preferred user-facing location:

actual golf venue

rather than generic city/state.

Example:

Reston National Golf Course

not:

Washington, VA

If automatic venue detection fails, manual venue selection must work.

Once a user confirms a venue near specific coordinates, remember it locally for future visits.

Manual confirmation should override generic reverse-geocoding.

Location failure must never block starting a session.

---

## 24. Home / Paused Session

If a session is unfinished, Home should allow:

Resume Session

and:

End Session

Resume remains dominant.

End is visible but secondary.

Zero-shot sessions should use:

Discard Session

rather than saving meaningless empty sessions.

---

## 25. Analytics Principles

Prefer:

- percentages
- percentage-point comparisons
- streaks
- rolling Best 10
- medians
- consistency
- contextual comparisons

Do not equate:

more distance = better

unless target/practice context supports it.

Use comparable-session logic when comparing history.

Do not compare clearly different practice contexts just to produce an insight.

---

## 26. Retention Philosophy

Next Ball should create the loop:

Practice
-> Log
-> Discover
-> Set Goal
-> Return
-> Compare

The current product-validation milestone is repeated voluntary use.

Before aggressive monetization, validate that golfers want to use Next Ball across multiple range sessions.

---

## 27. Monetization Direction

Do not put core logging behind a paywall.

Potential future structure:

### Free

- shot logging
- local history
- basic recap
- simple trends
- export/backup

### Next Ball Plus

Potential future features:

- cloud sync
- deeper trends
- club-by-club progress
- drill comparisons
- Training Aid comparisons
- practice-plan recommendations
- richer historical analysis
- advanced target practice
- coach sharing

### Future Premium

Potential future features:

- swing video capture
- automatic swing segmentation
- tempo measurement
- pose tracking
- swing analysis
- AI-assisted practice insights

Do not implement monetization prematurely.

---

## 28. Camera / Future Swing Analysis

Long-term opportunity:

link individual swing video to individual shot outcome.

Possible progression:

1. attach video to shot
2. slow motion / frame-by-frame
3. automatic address/top/impact/finish detection
4. tempo measurement
5. pose tracking
6. outcome-correlated swing analysis

This is future roadmap, not current scope.

---

## 29. Development Rules

Before making major UX changes:

- inspect existing implementation
- preserve working business logic
- preserve stored data
- verify backward compatibility
- use local assets
- avoid unnecessary dependencies

When a mockup is supplied as:

TARGET DESIGN

match it closely rather than reinterpreting it.

If exact visual fidelity would destabilize working functionality, preserve the stable implementation and make the smallest visual adjustment.

---

## 30. Product Decision Hierarchy

When priorities conflict, use this order:

1. Data integrity
2. Logging speed
3. Simplicity
4. Outdoor usability
5. Useful insight
6. Visual polish
7. Additional features

Never sacrifice trustworthy shot data for visual polish.

---

## 31. Current Product Goal

The immediate goal is not maximum feature count.

The goal is to create a product that golfers voluntarily want to use again at their next range session.

Next Ball should increasingly answer:

"Is my practice actually working?"

rather than simply:

"What shots did I hit?"
