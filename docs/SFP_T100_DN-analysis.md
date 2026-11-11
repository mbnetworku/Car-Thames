# SFP_T100_DN.apk analysis

## Summary
`SFP_T100_DN.apk` is **not a standalone app**. It is a theme (skin) plugin for an Android car head-unit launcher. It has no activity or launcher icon, so on a normal phone it installs but does nothing. A compatible car launcher loads it and uses its images, fonts and JSON layouts to draw the home screen.

## Identity
| Item | Value |
|---|---|
| Package | `launcher.variety.theme.plugin.sfp_t100_dn` |
| Plugin meta-data | `launcher.variety.theme.plugin` = `sfp_t100_dn` |
| Version | code 353, name `353_240111155142.all` (built 2024-01-11) |
| SDK | min 16, target 26, compiled against 29 |
| Theme ID / OEM ID | `20230808160920` / `190` (`assets/import_theme_info_config.json`) |
| Display name | `SFP_T100_DN` (string resource `theme_name`) |
| Extra meta-data | `support_systemui`, `support_systemui_night`, `support_night` = true |
| Signer | Self-signed `CN=Zheng, OU=jkkj, O=jk, L=gd, ST=sz`, SHA1withRSA, valid 2016–2041 |
| Signer SHA-256 | `5B:88:18:77:16:D7:4B:CA:64:1B:35:DA:26:1C:FA:52:F8:64:67:DD:DA:0A:C6:09:90:83:18:4D:F8:42:99:9D` |

## Contents
- **Code (`classes.dex`, ~164 KB, 35 classes):**
  - The Qihoo360 **RePlugin** plugin loader stub.
  - `variety.theme.ThemeMocker`, a FrameLayout used to draw placeholders in previews.
  - Generated `R` classes.
  - There is no theme logic in code.
- **Resources (~15 MB, 619 images):** backgrounds, icons, the speedometer pointer and gauge, weather art, and day/night variants.
- **Fonts:** `gilroy-regular-3.otf` and 庞门正道标题体.ttf.
- **`assets/` JSON layouts:** one set per screen size, under `layout-1600x720`, `layout-1280x480` and `layout-768x880`, plus a default set. These are the widget types used:

| `soft_type` | Purpose |
|---|---|
| `app` | App shortcut / hotseat icon |
| `clock`, `time` | Analog and digital clock |
| `weather` | Weather card |
| `speed_text`, `speed_effect` | Speed display and 3D road animation |
| `navi` | Navigation map widget |
| `medias` | Music and radio widget |
| `lego` | Configurable card layout |
| `desktop_window`, `dw_app_setting` | Floating desktop windows |

- **`assets/tw/systemui`:** a status bar skin.

## Behavior and safety
- **No network code:** no URLs, sockets or HTTP clients.
- **No code execution tricks:** no `Runtime.exec`, no native libraries and no dynamic dex loading in the plugin itself.
- **Unused permissions:** it declares `READ_PHONE_STATE`, `READ/WRITE_EXTERNAL_STORAGE`, but no code uses them. They are template boilerplate.
- **Verdict:** a resource-only skin package. Nothing malicious was found.

## How to make a derived theme
Verified with apktool 2.10.0 and uber-apk-signer 1.3.0. The `windows/` tool automates all of this.

1. Decode the APK: `java -jar apktool.jar d SFP_T100_DN.apk -o src`
2. Edit `src/AndroidManifest.xml`:
   - set `package` to `launcher.variety.theme.plugin.<new_name>`;
   - set the `launcher.variety.theme.plugin` meta-data value to `<new_name>`.
3. Set a new `themeId` in `src/assets/import_theme_info_config.json`. **Keep `oemId`.**
4. Change `theme_name` in every `res/values*/strings.xml`.
5. Replace images and edit the JSON layouts.
6. Rebuild: `java -jar apktool.jar b src -o unsigned.apk`
7. Sign: `java -jar uber-apk-signer.jar -a unsigned.apk --ks your.jks --ksAlias ...`

**Open question:** does the car launcher check the plugin's signing certificate? Answering that needs the launcher APK from the head unit.
