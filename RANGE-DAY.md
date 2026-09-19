# V4.3 Swing Lab — range day checklist

Work down this list in order. Items 1–4 happen before you leave.

1. **Force-quit the installed app twice.** iOS keeps a service worker alive
   across a single quit; the second launch is the one that picks up v87.
   Confirm the build number reads **v87** on Settings before you drive off.

2. **Check free storage.** Settings shows what Swing Lab is holding. Video is
   the only thing in this app that can fill a phone, and iOS refuses
   persistent storage outright, so the system may evict clips under pressure.
   Start the day with room to spare.

3. **Set the camera up before the first swing, not after.** This is the
   single thing most likely to waste the trip. See item 5.

4. **Take a tripod or something to lean the phone against.** Handheld
   recording moves the camera relative to you, which is exactly what the
   engine now refuses to measure.

5. **Frame it at about 8 feet, whole body in shot, phone steady.** On the one
   piece of real footage tested, the golfer was far enough away that pose
   tracking never locked on: shoulder width wandered between 2% and 21% of
   the frame, and the strongest movement in 54 seconds was the walk back to
   the phone. That clip now correctly measures nothing. Close and steady is
   what makes the difference.

6. **Record down-the-line for the first few.** Face-on supports fewer
   measurements; get one view working before adding the second.

7. **Record, then log the shot.** The swing holds for up to two minutes
   waiting for a shot to attach itself to. Log the shot as you normally
   would — there is no "attach this swing?" prompt, by design.

8. **Confirm the shot row says "Swing linked."** If it does not, the swing
   was recorded outside the window and will show in Swing Lab as unpaired.
   That still analyses; it just has no outcome beside it.

9. **Analyze one swing before recording twenty.** It takes roughly 9 seconds
   on this footage. Open **Analysis quality** and read **Body tracking**.
   - *steady* — the camera is right, carry on.
   - *unsteady* — move the camera closer and reframe before you spend the
     session on footage that cannot be measured.

10. **Check the checkpoints actually land on your swing.** Scrub Address,
    Top, Impact and Finish. They should sit where you would put them. Phase
    detection has never been validated against real, correctly-framed golf
    footage — this is the main thing today is for.

11. **Turn the pose overlay on once.** It should track your body, not drift
    onto a neighbouring bay. If it wanders, the measurements are worthless
    however plausible they look.

12. **Note anything the numbers claim that your eyes disagree with.** The
    engine measures; it does not yet interpret. A number that contradicts
    what you saw is the most useful thing you can bring back.

## What today cannot tell you

- **Tempo.** It needs 60 fps or more. At 30 fps too few frames span impact
  to time it honestly, so it is withheld rather than estimated. Record in
  slow motion if you want to test that path.
- **Anything in inches or degrees of real space.** 2D video carries no
  scale; distances are in shoulder widths and always will be.
- **Whether a position is good.** No scores, no comparisons, no coaching.
  That is deliberate and unchanged.
