# Launch notes (not published yet)

Everything below is a draft for the day the repo goes public. Nothing here has been posted.

## Show HN

**Title:** Show HN: Captionsafe – add b-roll to a captioned video without hiding the captions

**Body:**

I make short vertical videos, and every time I wanted to cut to a photo while the speaker keeps talking I hit the same wall: the captions are burned into the picture, so the photo covers them. Cutting the photo into the timeline drifts the audio; re-captioning by hand is worse.

Captionsafe lays the still over the footage and then redraws the captions on top of it, by cutting them out of the frames they were burned into. The timeline, audio and caption timing are untouched.

The detection is the interesting part. Saturated pixels alone are useless — footage is saturated too. What separates a caption from a sunset is that the outline colour touches near-neutral letter bodies, so only those saturated pixels are histogrammed. A near-neutral pixel is then kept only if outline pixels enclose it on all four sides, which throws away skin, hair and sky.

Node + ffmpeg, no native deps: `npx captionsafe -i clip.mp4 -o out.mp4 --insert 7.6,3.4,photo.jpg`

Known limits are in the README (captions without an outline, captions that move around the frame). Sample clips where the detector fails are the most useful thing you can send me.

## r/ffmpeg, r/VideoEditing, r/NewTubers

Same story, shorter, lead with the GIF. No install pitch; ask what breaks.

## Threads / X (@burakeyler), Turkish

Kısa videolarına araya fotoğraf koyunca alt yazıların kayboluyor mu?

Bunu çözen küçük bir araç yazdım: fotoğrafı videonun üstüne koyuyor, alt yazıları da fotoğrafın üstüne geri çiziyor. Video uzamıyor, ses kaymıyor, alt yazı senkronu bozulmuyor.

Ücretsiz ve açık kaynak: github.com/burakeyler/captionsafe

## Checklist for launch day

- [ ] Repo public, topics: ffmpeg, video, captions, subtitles, broll, cli
- [ ] `npm publish` (name `captionsafe` was free on 2026-09-16)
- [ ] Post Show HN in the morning US time, then Reddit, then Threads
- [ ] Watch issues for the first 48 hours and answer every one the same day
