# Miss Globe TV — Firestick app

Watch a Miss Globe show from YouTube with the **live judging scoreboard** from
[globe2026.ollpot.life](https://globe2026.ollpot.life/) down the right-hand side.

- **80 / 20 split:** YouTube video on the left, live scores on the right (updates every 5 s).
- Scoreboard shows the leader card, then everyone ranked with photo, flag, country,
  joint score /50 and each judge's total. New scores flash; rank moves show ▲/▼.
- **Live vote pop-ups (top left):** "Olly voted Débora Santos a 10 for Swimwear" with her photo, the
  score, and her new rank and total — the moment a judge taps a score on the judging desk.
- **Recap (▼):** a TV-made recap built from the judging data, with the video kept in the corner.
  Page 1 *Overview*: headline, key stats, Crown watch Top 5, category leaders, latest votes, judges' favourites.
  Page 2 *Storylines*: the same storyline rules as the website, judge coverage and the bottom 5.
  Pages change with ▲ ▼ and rotate on their own every 30 s.
- **Events:** keep a list of Miss Globe shows (name + YouTube link) and switch between them.
- **Resume:** remembers where you stopped in each video, even after the Firestick restarts.

## Remote controls

**Watching**

| Button | What it does |
|---|---|
| OK | Open the player controls |
| ◀ ▶ | Skip back / forward 10 s. Keep tapping (or hold) and it jumps 30 s at a time. Taps add up on screen, and the video jumps once you stop |
| ⏪ ⏩ | Skip 30 s |
| ⏯ | Play / pause |
| ▲ | Show / hide the scoreboard |
| ▼ | Open Recap |
| ≡ Menu | Events (switch show / add a link) |
| Back | Press twice to exit |

**Player controls** (after pressing OK): ◀ ▶ choose a button, OK presses it, ▲ ▼ or Back hides them.
Buttons: ⏪ 30s · ↺ 10s · ⏯ · 10s ↻ · 30s ⏩ · Scores · Recap · Events · Start over.

**Recap:** ▲ ▼ change page, Back returns to the video. **Events menu:** arrows move, OK selects, Back closes.

## Install on the Firestick

1. On the Firestick, install **Downloader** (by AFTVnews) from the Amazon Appstore.
2. Go to **Settings → My Fire TV → Developer options → Install unknown apps** and turn on **Downloader**.
   (If you don't see Developer options: **Settings → My Fire TV → About**, then click the device name 7 times.)
3. Open Downloader and type this address:
   `https://github.com/Ollyisgreat/globe2026/releases/latest/download/MissGlobeTV.apk`
4. Choose **Install**, then **Open**. The app appears under **Your Apps** as *Miss Globe TV*.
5. On first launch, the Events menu opens: type the YouTube link (or just the 11-character video ID) and choose **Save**.

To update, repeat step 3; it installs over the old version and keeps your events.

## How it works

- `app/src/main/assets/` is the TV screen (HTML/CSS/JS). The Android app (`MainActivity.java`)
  is a full-screen WebView that serves those files at `https://globe2026.ollpot.life/__tv/`,
  so the page can read `api.php` and the delegate list directly, with no changes needed on the website.
- The delegate list, categories and judges are read from the live site's `index.html` on start-up;
  `roster-fallback.js` is an offline copy (regenerate with `node tools/build-roster.js index.html`).
- YouTube plays through the official embedded player. It **can't sign in to a YouTube account**
  (Google blocks sign-in inside apps like this), so the video must be public or unlisted, and the
  owner must allow embedding. Watch progress is saved in the app instead of your YouTube history.
- Every push to `main`/`master` builds the APK with GitHub Actions and publishes it as the latest release.

To preview the screen on a computer: serve `app/src/main/assets` and open `index.html`.
The keyboard works as the remote (arrows, Enter, Space, `M` = menu, Esc = back).
