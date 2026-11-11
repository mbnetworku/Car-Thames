# Car Launcher

An Android home screen app that draws its home screen from **variety theme** APKs: the ones you make with Car Theme Studio, or the original `launcher.variety.theme.plugin.*` themes. It reads only the theme's images, fonts and JSON layouts. No code from a theme is ever run.

## Install
1. Install `CarLauncher.apk` (from `windows/launcher/`, the Studio's **Download CarLauncher.apk** button, or the GitHub Actions artifact).
2. Install one or more theme APKs.
3. Press **Home** and choose **Car Launcher**, then **Always**. You can also use the launcher menu: **Make Car Launcher the default home screen**.

## Using it
| Action | What happens |
|---|---|
| Tap an app slot | Opens the app (an empty slot opens the app picker) |
| Long-press an app slot | Choose a different app, "All apps", or make the slot empty |
| Long-press the navigation, music or map window | Choose which app it opens |
| Media buttons | Previous, play/pause and next for the current player |
| Swipe the left card | Switch between the theme's card pages (navigation/speed ↔ music) |
| Window-settings button, or long-press an empty area | Launcher menu |

**Launcher menu:**
- choose a theme;
- day/night mode (Auto follows the car, or force Day or Night);
- themed app icons on or off;
- all apps;
- reset shortcuts;
- set as the default home screen.

**What it supports:**
- **Screen sizes:** it picks the theme layout that best matches the screen (exact size, otherwise the same aspect ratio) and scales it to fill the screen.
- **Widgets:** app slots, the quick-apps panel, digital time and date, an analog clock (from the theme's dial and hand images), speed from GPS, the speed animation (faster frames at higher speed), navigation, music, the map/app window, and backgrounds.
- **Night mode:** day and night images.
- **Theme fonts and colors.**

**Not supported:**
- **Weather:** there's no data source, so it shows the icon and `--°` only.
- **Embedding other apps:** the map window opens your chosen app instead of showing it inside the home screen.

## Build
No Android SDK or Gradle is needed. The script downloads `android.jar`, `dx`, apktool (for `aapt2`) and uber-apk-signer into `.tools/`:

```bash
./build.sh            # -> build/CarLauncher.apk
```

Updates must be signed with the same key as the installed copy, otherwise Android refuses the update. By default the script creates `.tools/launcher.jks` (password `carlauncher`). Keep that file. To use your own key:

```bash
KEYSTORE=my.jks KS_ALIAS=me KS_PASS=secret ./build.sh
```

GitHub Actions (`.github/workflows/launcher.yml`) builds it on every change. To have it signed with a fixed key, add these repository secrets:
- `LAUNCHER_KEYSTORE_B64`: the keystore file, base64-encoded;
- `LAUNCHER_KS_ALIAS`: the key alias;
- `LAUNCHER_KS_PASS`: the password.
