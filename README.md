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

This is a personal app for you. It is not sold or code-signed, so macOS will
warn you the first time you open it — there's a one-time "right-click → Open"
step covered below.

---

## What you need on the Mac (one-time)

1. **GitHub Desktop** — to download (clone) and later update this project.
   Get it from <https://desktop.github.com>.
2. **Node.js (LTS version)** — this provides the `npm` command used to build
   the app. Get it from <https://nodejs.org> (click the big "LTS" button and
   run the installer).

You do **not** need to be a developer to follow these steps. You'll copy a
couple of commands into the Terminal app and press Return.

---

## Step 1 — Get the project onto your Mac (GitHub Desktop)

1. Open **GitHub Desktop** and sign in.
2. **File → Clone repository…**
3. Choose **acceleratecontroller/ACOMS.Launcher** from the list, pick a folder
   you'll remember (e.g. your Documents folder), and click **Clone**.
4. GitHub Desktop will download the project. Note the folder it created —
   you'll point Terminal at it in the next step.

> Later, when you want the newest version, open GitHub Desktop and click
> **Fetch origin** → **Pull origin**. That's the "pull" step referred to below.

---

## Step 2 — Open Terminal in the project folder

The easiest way:

1. Open the **Terminal** app (press `Cmd + Space`, type "Terminal", press
   Return).
2. Type `cd ` (the letters c, d, then a **space**) — but don't press Return
   yet.
3. Drag the **ACOMS.Launcher** folder from Finder onto the Terminal window.
   This pastes its location for you.
4. Press **Return**.

You're now "inside" the project folder, and the commands below will work.

---

## Step 3 — Install the app's building blocks (run once)

```bash
npm install
```

This downloads the bits the app is built from. It can take a minute or two the
first time. You only need to do this again if you ever delete the project and
re-clone it.

---

## Step 4 — Test it without building (optional but recommended)

```bash
npm run dev
```

This launches the launcher straight away so you can click around and check
your portals open correctly. Close the windows (or press `Cmd + Q` in
Terminal's running process / `Ctrl + C` in the Terminal) when you're done
testing.

---

## Step 5 — Build the real Mac app

```bash
npm run build
```

When it finishes, look in the new **`dist`** folder inside the project. You'll
find:

- **`ACOMS Launcher-1.0.0.dmg`** — the installer disk image, and
- an **`ACOMS Launcher.app`** (inside a `mac` / `mac-arm64` subfolder).

---

## Step 6 — Install it and pin it to the Dock

1. Double-click the **`.dmg`** file in `dist`.
2. In the window that opens, **drag `ACOMS Launcher` into your Applications
   folder** (you can drag it onto the Applications shortcut, or just drag the
   `.app` from the `dist` folder into Applications).
3. Open **Applications** and double-click **ACOMS Launcher**.

### The "unidentified developer" warning (one time only)

Because this is a personal app and not signed with a paid Apple Developer
account, the first time you open it macOS will say something like *"ACOMS
Launcher can't be opened because it is from an unidentified developer."* This
is expected — it's your own app.

To get past it **once**:

1. In **Applications**, **right-click** (or `Ctrl`-click) **ACOMS Launcher**.
2. Choose **Open**.
3. In the dialog, click **Open** again.

After this first time, it opens normally with a double-click.

> If macOS still refuses, go to **System Settings → Privacy & Security**,
> scroll down, and click **Open Anyway** next to the ACOMS Launcher message.

### Keep it in the Dock

With ACOMS Launcher running, **right-click its Dock icon → Options → Keep in
Dock**. Now it's one click away whenever you need it.

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

---

## The app icon

The Dock / taskbar icon is **`build/icon.png`** (1024×1024). `npm run build`
turns it into the proper Mac `.icns` and Windows `.ico` automatically — you
don't have to do anything.

To change the icon, just replace `build/icon.png` with any square (ideally
1024×1024) PNG and rebuild. The editable vector source is `build/icon.svg` if
you'd rather tweak the shapes/colours.

---

## Building the Windows version (on a Windows PC)

The Mac and Windows apps come from the **same code and the same
`portals.json`**, so they stay in sync — change a portal once, rebuild on each
machine. You build each version on its own operating system: the `.dmg` on a
Mac, the Windows installer on a PC. (You can't build the Windows version on
the Mac, or vice-versa.)

On the Windows PC, do this once:

1. **Install Node.js (LTS)** from <https://nodejs.org> — click the big "LTS"
   button and run the installer (accept the defaults).
2. **Install GitHub Desktop** from <https://desktop.github.com> and sign in.
3. In GitHub Desktop, **File → Clone repository → acceleratecontroller/
   ACOMS.Launcher**, and clone it to a folder you'll remember.
4. Open the **Command Prompt** (press the Start button, type `cmd`, press
   Enter), then point it at the project folder. Easiest way: in File Explorer,
   open the ACOMS.Launcher folder, click the address bar, type `cmd` and press
   Enter — a Command Prompt opens already in that folder.
5. Run these two commands, one after the other:

   ```bat
   npm install
   npm run build:win
   ```

6. When it finishes, open the **`dist`** folder inside the project. You'll find
   **`ACOMS Launcher Setup 1.0.0.exe`** — that's the installer.

### Installing it on Windows

1. Double-click **`ACOMS Launcher Setup 1.0.0.exe`** and follow the prompts.
   It creates a Desktop shortcut and a Start-menu entry.
2. **The "Windows protected your PC" warning** — because the app isn't signed
   with a paid certificate (same reason as the Mac "unidentified developer"
   message), Windows SmartScreen will show a blue box the first time. Click
   **"More info"**, then **"Run anyway"**. This is expected for a personal app.

### How it behaves on Windows

Windows has no Dock, so the launcher lives in the **system tray** — the little
cluster of icons next to the clock (you may need to click the small "^" arrow
to see hidden ones).

- **Open a portal:** the picker appears on launch; click a portal and it opens
  in its own window (the picker tucks away, just like on the Mac).
- **Bring the picker back:** **click the ACOMS icon in the system tray.** It
  pops up above the taskbar near the tray.
- **Right-click the tray icon** for a menu with **Open ACOMS Launcher** and
  **Quit**.
- Closing all the windows leaves the app running quietly in the tray — use the
  tray menu's **Quit** to fully close it.
- Tip: drag the ACOMS icon onto the always-visible part of the tray so it's
  never hidden behind the "^" arrow.

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
