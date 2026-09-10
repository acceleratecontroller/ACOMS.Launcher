# ACOMS Launcher

One Mac Dock icon for all your ACOMS web portals.

- Click the Dock icon → a small **picker** window lists every portal.
- Click a portal → it opens in its **own window**.
- Click the Dock icon again → the picker comes back, so you can open another.
- Pick a portal that's **already open** → it just jumps to the front (it does
  not reload).
- A **green dot** next to a portal means it's currently open.
- Closing all the windows does **not** quit the app — the Dock icon stays
  ready.
- **Cross-app links stay in the launcher.** A link from one portal to another
  (e.g. opening a job from WIP in GIS) switches to that portal's window — it
  doesn't escape to a browser tab.
- Links to **outside** websites (not one of your portals) open in your
  **normal default browser**.
- A separate **Quick Note** button (top of the picker) jumps straight to a
  fresh note in ACOMS.Controller, in its own small window, so you can jot
  something down fast.

This is a personal app for you. It is not sold or code-signed, so macOS will
warn you the first time you open it — there's a one-time "right-click → Open"
step covered below.

---

## Installing it

Download the installer from the
[latest release](https://github.com/acceleratecontroller/ACOMS.Launcher/releases/latest)
and run it. That's the whole thing — you do not need Node, GitHub Desktop, or
a terminal.

- **Windows** — `ACOMS Launcher Setup <version>.exe`. Windows SmartScreen
  shows a blue "Windows protected your PC" box the first time, because the app
  isn't signed with a paid certificate. Click **More info** -> **Run anyway**.
- **macOS** — `ACOMS Launcher-<version>.dmg`. Drag it into Applications. The
  first time, macOS says it's from an "unidentified developer" (same reason):
  **right-click** the app -> **Open** -> **Open**. After that it opens
  normally. If macOS still refuses, **System Settings -> Privacy & Security**
  -> **Open Anyway**.

The portals themselves are not installed — they're the same web apps on
Vercel, loaded over the network. Only this shell lives on your machine, and
you sign in to each portal exactly as you would in a browser.

---

## Notifications

Portals that offer a `summary` endpoint (see `portals.json`) are checked every
five minutes for things waiting on **you** — approvals in your queue, tasks
due, that sort of thing. When something new turns up you get a normal Windows
or macOS notification; clicking it opens that portal's window **at the
record**, not just at the front page.

**"New" means new since the launcher started watching.** The first time a
portal is checked, whatever is already open is recorded quietly and you are
not told about it — otherwise a fresh install would greet you with every
approval and overdue task you already knew about. From then on you hear about
things as they turn up. Something that stays open does not come back round and
interrupt you a second time; if it is resolved and later raised again, that is
a genuinely new event and you will be told.

What you'll see in the picker, on the right of each portal card:

| | Meaning |
|---|---|
| a red count | that many things are waiting on you |
| **Sign in** | that portal logged you out — it can't tell you anything until you open it and sign in again |
| **Muted** | you turned this portal's notifications off |
| **?** | couldn't reach the portal (usually just the network) |

The "Sign in" state matters: an expired session is shown rather than quietly
reported as zero, because "nothing waiting" and "I can't see" look identical
otherwise.

The header line summarises the total, the tray tooltip carries it too, and the
tray menu has **Check portals now** if you don't want to wait for the next
five-minute tick.

### Turning it down

The **⚙** button in the picker header opens the settings:

- **Notify me about** — untick any portal to mute it. Muted portals are still
  checked (so the count is right when you unmute) but never interrupt you.
- **Quiet hours** — set a start and end time and nothing will interrupt you
  between them. The range may cross midnight, so `18:00` to `07:00` works as
  you'd expect. Counts still update during quiet hours; you just aren't
  interrupted, and you won't get a backlog of overnight notifications dumped
  on you at 7am.

Both settings live on your machine, in the app's own data folder.

---

## Updates

The launcher keeps itself current. It checks shortly after startup, every
30 minutes after that, and again whenever the machine wakes from sleep.

- **Windows** — it downloads the update quietly in the background, then tells
  you it's ready. It never restarts on you mid-job: click **Restart** in the
  picker's footer (or **Restart to update** in the tray menu) when it suits.
  The update then applies quietly and the launcher reopens itself — you won't
  be walked through the installer again. (The full installer only appears the
  first time you set it up.)
- **macOS** — it tells you an update exists and gives you a **Download**
  button to the release page. It can't apply the update itself, because
  macOS only lets a *signed* app update in place and these builds are
  unsigned. Signing is a future step.

The current version is always in the bottom-right of the picker, next to a
**Check** button if you'd rather look now than wait.

---

## Working on the app (developers only)

You only need this if you're changing the launcher itself.

```bash
npm install     # once
npm run dev     # run from source
```

Updates are disabled when running from source — there's nothing to update to.

### Cutting a release

Releases are built by GitHub Actions, not on your machine. Both installers
come out of one CI run, so Windows and macOS can never drift apart:

1. Bump `"version"` in `package.json`.
2. Commit it, then tag and push:

   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

3. `.github/workflows/release.yml` builds the Windows `.exe` and the macOS
   `.dmg` and attaches them to a GitHub Release, along with `latest.yml` and
   `latest-mac.yml`.

> Those two `.yml` files are what an installed app reads to notice a new
> version. If they aren't attached to the release, nothing updates.

You can still build locally (`npm run build:win` / `npm run build`) to check
packaging, but don't hand those installers around — a locally built one isn't
part of the update chain.

---

## Changing the portal list later

The portal list lives in **`portals.json`** at the top of the project. You can
add, remove, or rename portals without touching any app code.

Each portal looks like this:

```json
{
  "id": "acoms-os",
  "name": "ACOMS.OS",
  "tagline": "People & identity",
  "url": "https://acoms-os.vercel.app"
}
```

- **`id`** — a short unique nickname (lowercase, no spaces). Keep it unique.
- **`name`** — what shows on the card.
- **`tagline`** — the small grey line under the name.
- **`url`** — the web address to open.

> ⚠️ The email, GIS and Controller URLs were **best guesses** during setup.
> Double-check they point at the right deployments and fix them here if not.

After editing `portals.json`:

1. Save the file.
2. If you edited it directly on the Mac, just **rebuild**: `npm run build`,
   then replace the app in Applications with the freshly built one.
3. If the change was made in the repo by someone else, first **pull** the
   latest in GitHub Desktop (**Fetch origin → Pull origin**), then run
   `npm run build` again.

### The Quick Note buttons

`portals.json` also has a `quickNote` block that powers the amber split button
at the top of the picker — **New Note** and **View Notes**:

```json
"quickNote": {
  "new": {
    "label": "New Note",
    "url": "https://acoms-controller.vercel.app/tasks?tab=notes&compose=1"
  },
  "view": {
    "label": "View Notes",
    "url": "https://acoms-controller.vercel.app/tasks?tab=notes"
  }
}
```

- **New Note** → `?tab=notes&compose=1` opens Controller's Quick Notes tab and
  starts a fresh note automatically.
- **View Notes** → `?tab=notes` opens the Quick Notes tab so you can browse
  what you've written.

The auto-open-a-note behaviour needs the matching Controller update
**deployed** (it is, as of this feature). Change the `label`s or `url`s to suit,
or drop either half (`new` / `view`) to show only one. Remove the whole
`quickNote` block to hide the buttons entirely.

---

## The app icon

The Dock / taskbar icon is **`build/icon.png`** (1024×1024). `npm run build`
turns it into the proper Mac `.icns` and Windows `.ico` automatically — you
don't have to do anything.

To change the icon, just replace `build/icon.png` with any square (ideally
1024×1024) PNG and rebuild. The editable vector source is `build/icon.svg` if
you'd rather tweak the shapes/colours.

---

## How it behaves on Windows

Windows has no Dock, so the launcher lives in the **system tray** — the
cluster of icons next to the clock (click the "^" arrow to see hidden ones).

- **Open a portal:** the picker appears on launch; click a portal and it opens
  in its own window (the picker tucks away).
- **Bring the picker back:** click the ACOMS icon in the system tray. It pops
  up above the taskbar.
- **Right-click the tray icon** for a menu with **Open ACOMS Launcher**, the
  current version, **Check for updates**, and **Quit**.
- Closing every window leaves the app running quietly in the tray — use the
  tray menu's **Quit** to close it properly.
- Tip: drag the ACOMS icon onto the always-visible part of the tray so it's
  never hidden behind the "^".

---

## Troubleshooting

- **`npm: command not found`** — Node.js isn't installed (or Terminal was open
  before you installed it). Install Node.js from <https://nodejs.org>, then
  close and reopen Terminal.
- **A portal shows a blank/error page** — check its `url` in `portals.json`,
  and make sure you have internet access. These are live web apps.
- **The picker doesn't reappear when I click the Dock icon** (Mac) — make sure
  the app is actually still running (its Dock icon should be there). Clicking
  it brings the picker back.
- **I can't find the launcher on Windows** — look in the system tray (next to
  the clock; click the "^" arrow to reveal hidden icons). Click the ACOMS icon
  to summon the picker. If it's not there at all, the app has been quit — open
  it again from the Desktop shortcut or Start menu.
- **`'npm' is not recognized` (Windows)** — Node.js isn't installed, or the
  Command Prompt was open before you installed it. Install Node.js from
  <https://nodejs.org>, then close and reopen the Command Prompt.
