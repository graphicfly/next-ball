# V4.3 Swing Lab — range day checklist

Updated after the first real range session, which found five faults in the
analysis engine and three in the capture flow. All are fixed in **v91**.

Work down this list in order. Items 1–3 happen before you leave.

## Before you go

1. **Force-quit the installed app twice.** iOS keeps a service worker alive
   across a single quit; the second launch is the one that picks up new code.
   Confirm the build reads **v91** on Settings before you drive off.

2. **Check free storage.** Settings shows what Swing Lab is holding. Video is
   the only thing in this app that can fill a phone, and iOS refuses
   persistent storage outright, so the system may evict clips under pressure.
   Start with room to spare.

3. **Take something to prop the phone against.** Handheld moves the camera
   relative to you, which the engine will refuse to measure.

## Setting up

4. **Frame it the way your sample clip was framed.** That footage tracked
   your head, shoulders, hips, knees and ankles at 100%, which is as good as
   this engine gets. Whole body in shot, phone steady, close enough to fill a
   good share of the frame.

   The earlier "about 8 feet" advice came from a metric that was wrong — it
   was measuring your shoulders turning and calling it camera shake. Your own
   clip is the better reference.

5. **Front camera is now the default,** so the screen faces you while you set
   up. Tap **switch** under the view hint to use the rear camera instead; the
   choice is remembered. The preview is deliberately not mirrored, so what you
   frame is exactly what gets recorded and measured.

6. **Pick your view honestly.** Face-on gives head sway, hip sway, elbow
   spacing and hand path. Down the line gives head depth, hip depth and
   posture change. Tempo and swing duration work from either.

## Recording

7. **Wait for READY.** The armed screen now shows **WAITING** until it has
   seen about a second of stillness, then flips to **READY**. This is the fix
   for recordings that fired while you were still walking in. If it sits on
   WAITING, something in frame is moving.

8. **Record, then log the shot.** The swing holds for about two minutes
   waiting for a shot to attach to. Log the shot as you normally would —
   there is no "attach this swing?" prompt, by design.

9. **Confirm the shot row says "Swing linked."** It now clears when you log
   the next ball, so if it still says "Swing linked" while you are logging a
   fresh shot, that is a bug worth reporting.

## Checking the analysis

10. **On your first analysis, read "Camera gave" and "Frame rate".**
    "Camera gave" is what Safari negotiated; **Frame rate** just above it is
    what the frames actually measured, and that is the one that matters.
    60 or above unlocks tempo. Below it, tempo is withheld rather than
    estimated.

    The front camera may not reach 60. If it does not and you want tempo,
    switching to the rear camera is the trade.

11. **Read "Body tracking".** *steady* means the framing is right.
    *unsteady* means reframe before spending the session on footage that
    cannot be measured.

12. **Check the checkpoints land on your swing.** Scrub Address, Top, Impact
    and Finish. On the sample clip these now read backswing 0.95 s and
    downswing 0.53 s, which is plausible but not proven — real tempo is
    usually nearer 3:1 than the 1.78:1 measured, so the top may be landing
    slightly late. **This is the main thing to judge today.**

13. **Turn the pose overlay on once.** It should track you, not drift onto a
    neighbouring bay.

14. **Note anything the numbers claim that your eyes disagree with.** The
    engine measures; it does not interpret. A number that contradicts what you
    saw is the most useful thing you can bring back.

## What today still cannot tell you

- **Anything in inches or degrees of real space.** 2D video carries no scale;
  distances are in shoulder widths and always will be.
- **Whether a position is good.** No scores, no comparisons, no coaching.
  Deliberate and unchanged.
- **Tempo, unless the measured frame rate is 60 or higher.**

## Known soft spots

- The settle window before READY is tuned by reasoning, not range data. Too
  slow or still too eager, and it is a one-line change.
- Downswing timing looks slightly long, which would make tempo read low.
- Recording still requires a live range session. Starting one you never log a
  shot in is a perfectly ordinary way to test framing.
