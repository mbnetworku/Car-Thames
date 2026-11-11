# Car Themes

Tools and notes for building custom **"variety theme" plugin APKs** for Android car head units. These are the home-screen skins used by many aftermarket Android car stereos.

## What's here

| Path | What it is |
|---|---|
| `windows/Start-ThemeStudio.bat` | Double-click to start. Asks for Administrator, then launches the web UI |
| `windows/ThemeStudio.ps1` | Local PowerShell web server on `http://localhost:8765/` that does the work |
| `windows/web/index.html` | The web UI |
| `docs/SFP_T100_DN-analysis.md` | Reverse-engineering notes on the SFP_T100_DN theme used as the first template |

## Car Theme Studio (Windows)

1. Download this repo (green **Code** button, **Download ZIP**) and unzip it.
2. Double-click `windows\Start-ThemeStudio.bat` and accept the Administrator prompt.
3. The browser opens on `http://localhost:8765/`. In the page:
   1. **Setup:** click **Install Java** (installs Temurin JDK 17 via winget) and **Download tools** (apktool and uber-apk-signer). This is only needed once.
   2. **Load a template:** drop an existing theme APK, for example `SFP_T100_DN.apk`.
   3. **Theme identity:** set a new ID name (for example `my_theme_01`), a display name and a theme number.
   4. **Layout designer and preview:** see the home screen at its real size (1600×720, 1280×480, 1024×600 or 768×880), in day or night mode. The designer lets you:
      - **Move and resize** anything: drag a box to move it and drag its corner to resize it. Arrow keys nudge it 1 px (with Shift, 10 px). You can also type exact X, Y, width and height.
      - **Add, duplicate or delete app slots.** For each slot, choose whether the driver can pick its app with a long-press on the car.
      - **Change icon size, label size**, or hide app names.
      - **Set transparency** for any panel or the wallpaper with a slider. It's baked into the image, and JPGs become PNGs automatically. The originals are kept, so setting 0% restores them.
      - **Preview apps:** pick which app icon to show in each slot. This is only for the preview; on the car, the driver picks the app.
      - **Full screen preview**, and **Save preview as PNG**.
      - Click **Save design** before building.
   5. **Images:** click any image to replace it with your own.
   6. **Layout files:** edit the raw JSON (advanced).
   7. **Build signed APK:** the result goes to `windows\output\`.
4. Install it on the head unit from a USB stick, or with **Install via ADB** if `adb` is available.

### Why it runs as Administrator
Installing Java system-wide with winget needs admin rights. The server itself only listens on `localhost`, so it is not reachable from your network.

## Important notes

- **Keep the OEM ID** (`190` for SFP_T100_DN) and the package prefix `launcher.variety.theme.plugin.`. The car's launcher uses these to find themes.
- **Use a new ID name** so your theme installs next to the original instead of replacing it.
- **Signing:** your theme is signed with your own key (created once in `windows\workspace\theme-release.jks`). If the car's launcher only accepts themes signed by the manufacturer, it will refuse yours. The only way to know is to test. Back up `theme-release.jks`: later updates of the same theme must use the same key.
- **No template APKs or extracted images are committed here**, because they belong to the head unit manufacturer. Load your own copy into the tool.
- **Screen sizes:** the template ships layouts for 1600×720, 1280×480 and 768×880 screens.
