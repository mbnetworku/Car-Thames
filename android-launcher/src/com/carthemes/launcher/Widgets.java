package com.carthemes.launcher;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.os.SystemClock;
import android.text.format.DateFormat;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Builds the home screen from a theme's hotseat_config.json and theme_config.json. */
class Widgets {
    interface Ticker { void tick(); }
    interface SpeedListener { void onSpeed(float kmh); }

    final HomeActivity a;
    final Theme t;
    final List<Ticker> tickers = new ArrayList<>();
    final List<SpeedListener> speedListeners = new ArrayList<>();
    boolean usesSpeed = false;

    Widgets(HomeActivity a, Theme t) { this.a = a; this.t = t; }

    // ------------------------------------------------------------------ screen

    FrameLayout build() {
        FrameLayout root = new FrameLayout(a);
        root.setClipChildren(true);

        JSONObject theme = t.json("theme_config.json");
        JSONObject hot = t.json("hotseat_config.json");

        if (theme != null) {
            Drawable bg = t.drawable(theme.optString("background"), "mipmap");
            if (bg != null) root.setBackground(bg); else root.setBackgroundColor(Color.BLACK);
            JSONArray pages = theme.optJSONArray("config");
            if (pages != null && pages.length() > 0) {
                PagesLayout pl = new PagesLayout(a);
                for (int p = 0; p < pages.length(); p++) {
                    JSONObject page = pages.optJSONObject(p);
                    FrameLayout pf = new FrameLayout(a);
                    Drawable pbg = t.drawable(page.optString("page_bg"), "mipmap");
                    if (pbg != null) pf.setBackground(pbg);
                    JSONArray items = page.optJSONArray("page_config");
                    for (int i = 0; items != null && i < items.length(); i++) {
                        JSONObject it = items.optJSONObject(i);
                        View v = widget(it, "p" + p + "_" + i, "mipmap");
                        if (v != null) pf.addView(v, Geo.params(it));
                    }
                    pl.addPage(pf);
                }
                root.addView(pl, new FrameLayout.LayoutParams(-1, -1));
            }
        } else root.setBackgroundColor(Color.BLACK);

        if (hot != null) {
            String hint = hot.optString("image_path", "mipmap");
            Drawable hbg = t.drawable(hot.optString("background"), hint);
            FrameLayout hf = new FrameLayout(a);
            if (hbg != null) hf.setBackground(hbg);
            JSONArray cfg = hot.optJSONArray("config");
            int n = cfg == null ? 0 : cfg.length();

            // Items listed in a lego's include_widget_indices live inside that lego box.
            Set<Integer> inLego = new HashSet<>();
            JSONObject[] legoCfg = new JSONObject[n];
            for (int i = 0; i < n; i++) {
                JSONObject it = cfg.optJSONObject(i);
                if ("lego".equals(it.optString("soft_type"))) {
                    legoCfg[i] = t.json(it.optString("config_file_path"));
                    JSONArray inc = legoCfg[i] == null ? null : legoCfg[i].optJSONArray("include_widget_indices");
                    for (int k = 0; inc != null && k < inc.length(); k++) inLego.add(inc.optInt(k));
                }
            }
            seedDefaults(cfg);
            for (int i = 0; i < n; i++) {
                if (inLego.contains(i)) continue;
                JSONObject it = cfg.optJSONObject(i);
                View v = widget(it, "h" + i, hint);
                if (v == null) continue;
                if (legoCfg[i] != null && v instanceof FrameLayout) {
                    JSONArray inc = legoCfg[i].optJSONArray("include_widget_indices");
                    for (int k = 0; inc != null && k < inc.length(); k++) {
                        int ci = inc.optInt(k);
                        JSONObject child = cfg.optJSONObject(ci);
                        if (child == null) continue;
                        View cv = widget(child, "h" + ci, hint);
                        if (cv != null) ((FrameLayout) v).addView(cv, Geo.params(child));
                    }
                }
                hf.addView(v, Geo.params(it));
            }
            root.addView(hf, new FrameLayout.LayoutParams(-1, -1));
        }
        return root;
    }

    private String slotKey(String id) { return t.pkg + "|" + t.layoutDir + "|" + id; }

    /** First time a theme is shown, fill its app slots with sensible apps so the screen isn't empty. */
    private void seedDefaults(JSONArray cfg) {
        String flag = "seeded:" + t.pkg + "|" + t.layoutDir;
        if (cfg == null || Apps.prefs(a).getBoolean(flag, false)) return;
        String[][] wanted = {
                {"maps", "navi", "gps"}, {"music", "player"}, {"dialer", "bluetooth", "phone"}, {"video", "youtube"},
                {"radio", "fm"}, {"setting"}, {"file", "explorer"}, {"browser", "chrome"}, {"camera", "dvr"},
                {"gallery", "photos"}, {"vending", "store", "market"}, {"calculator"}, {"calendar"}, {"clock"}};
        Set<String> used = new HashSet<>();
        int w = 0;
        for (int i = 0; i < cfg.length(); i++) {
            JSONObject it = cfg.optJSONObject(i);
            if (!"app".equals(it.optString("soft_type"))) continue;
            String key = slotKey("h" + i);
            if (Apps.get(a, key) != null) continue;
            if ("apps".equals(it.optString("background"))) { Apps.set(a, key, Apps.ALL_APPS); continue; }
            while (w < wanted.length) {
                String g = Apps.guess(a, wanted[w++]);
                if (g != null && used.add(g)) { Apps.set(a, key, g); break; }
            }
        }
        if (Apps.get(a, slotKey("navi")) == null) Apps.set(a, slotKey("navi"), Apps.guess(a, "maps", "navi", "waze", "gps"));
        if (Apps.get(a, slotKey("music")) == null) Apps.set(a, slotKey("music"), Apps.guess(a, "music", "player", "spotify"));
        Apps.prefs(a).edit().putBoolean(flag, true).apply();
    }

    // ------------------------------------------------------------------ one widget

    private View widget(final JSONObject it, final String id, String hint) {
        if (it == null) return null;
        String type = it.optString("soft_type");
        FrameLayout box = new FrameLayout(a);
        Drawable bg = t.drawable(it.optString("background"), hint);
        if (bg != null) box.setBackground(bg);
        JSONObject vc = t.json(it.optString("view_config_path"));
        JSONObject conf = t.json(it.optString("config_file_path"));

        switch (type) {
            case "app": return appSlot(box, it, vc, slotKey(id));
            case "time": time(box, vc, conf); break;
            case "clock": clock(box, conf); break;
            case "weather": weather(box, vc); break;
            case "speed_text": speedText(box, vc); break;
            case "speed_effect": speedEffect(box, conf); break;
            case "navi": appCard(box, vc, slotKey("navi"), "Navigation app", "Navigation", false); break;
            case "desktop_window": appCard(box, null, slotKey("window"), "App for this window", null, true); break;
            case "medias": media(box, vc, conf); break;
            case "dw_app_setting":
                box.setOnClickListener(new View.OnClickListener() { @Override public void onClick(View v) { a.showSettings(); } });
                break;
            default: break; // lego, image: background only
        }
        return box;
    }

    // ------------------------------------------------------------------ parts from view_config

    private void forEachAttr(JSONObject vc, AttrFn fn) {
        JSONArray attrs = vc == null ? null : vc.optJSONArray("attributes");
        for (int i = 0; attrs != null && i < attrs.length(); i++) {
            JSONObject at = attrs.optJSONObject(i);
            if (at == null || !at.optBoolean("visibility", true)) continue;
            fn.on(at.optString("id_name"), at);
        }
    }
    interface AttrFn { void on(String id, JSONObject at); }

    private TextView text(FrameLayout box, JSONObject at, String value) {
        float size = (float) at.optDouble("text_size", 16);
        if (size <= 0) return null;
        TextView tv = new TextView(a);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_PX, size);
        tv.setTextColor(t.color(at.optString("text_color"), Color.WHITE));
        tv.setSingleLine(true);
        tv.setIncludeFontPadding(false);
        Typeface tf = t.font(at.optString("typeface"));
        if (tf != null) tv.setTypeface(tf);
        if ("true".equals(at.optString("is_shadow"))) tv.setShadowLayer(3, 0, 1, Color.BLACK);
        int w = at.optInt("width", -2);
        if (w > 0) tv.setGravity(Gravity.CENTER_HORIZONTAL);
        tv.setText(value);
        box.addView(tv, Geo.params(at));
        return tv;
    }

    private ImageView image(FrameLayout box, JSONObject at, Drawable d) {
        if (d == null) return null;
        ImageView iv = new ImageView(a);
        iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        iv.setImageDrawable(d);
        box.addView(iv, Geo.params(at));
        return iv;
    }

    // ------------------------------------------------------------------ app slot

    private static final String[][] THEMED_ICONS = {
            {"maps", "app_navi"}, {"navi", "app_navi"}, {"music", "app_music"}, {"bluetooth", "app_bt"}, {"dialer", "app_bt"},
            {"video", "app_video"}, {"setting", "app_setting"}, {"radio", "app_radio"}, {"file", "app_file"},
            {"browser", "app_browser"}, {"chrome", "app_browser"}, {"camera", "app_camera"}, {"calculator", "app_calculator"},
            {"calendar", "app_calendar"}, {"vending", "app_googleplay"}, {"gallery", "app_gallery"}, {"photos", "app_gallery"},
            {"eq", "app_eq"}, {"360", "app_360"}};

    private Drawable themedIcon(Apps.App app) {
        if (!a.useThemeIcons()) return null;
        String s = (app.key + " " + app.label).toLowerCase(Locale.ROOT);
        for (String[] m : THEMED_ICONS) if (s.contains(m[0]) && t.hasImage(m[1])) return t.drawable(m[1], "mipmap");
        return null;
    }

    private View appSlot(final FrameLayout box, final JSONObject it, JSONObject vc, final String key) {
        final Apps.App app = Apps.resolve(a, Apps.get(a, key));
        final boolean drawerButton = app != null && Apps.ALL_APPS.equals(app.key);
        if (vc == null) {
            try { vc = new JSONObject("{\"attributes\":[{\"id_name\":\"iv_app_icon\",\"width\":48,\"height\":48,\"gravity\":\"center\"}]}"); } catch (Exception ignored) { }
        }
        forEachAttr(vc, new AttrFn() {
            @Override public void on(String id, JSONObject at) {
                if ("iv_app_icon".equals(id)) {
                    Drawable d;
                    if (app == null) d = a.getDrawable(android.R.drawable.ic_input_add);
                    else if (drawerButton) d = box.getBackground() != null ? null : t.drawable("app_apps", "mipmap");
                    else { d = themedIcon(app); if (d == null) d = app.icon; }
                    image(box, at, d);
                } else if ("tv_item".equals(id) && app != null && !drawerButton) {
                    text(box, at, app.label);
                }
            }
        });
        box.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (app == null) pick(key, true); else Apps.launch(a, app.key);
            }
        });
        box.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { pick(key, true); return true; }
        });
        return box;
    }

    private void pick(final String key, boolean allowEmpty) {
        Apps.showPicker(a, "Choose app", allowEmpty, new Apps.Picked() {
            @Override public void onPicked(String k) { Apps.set(a, key, k); a.rebuild(); }
        });
    }

    /** A card that opens one chosen app (navigation, the map window). Long-press to change it. */
    private void appCard(final FrameLayout box, JSONObject vc, final String key, final String pickTitle, final String name, boolean showApp) {
        forEachAttr(vc, new AttrFn() {
            @Override public void on(String id, JSONObject at) {
                if ("tv_navigation_name".equals(id) && name != null) text(box, at, name);
            }
        });
        final Apps.App app = Apps.resolve(a, Apps.get(a, key));
        if (showApp && app != null && app.icon != null) {
            // Show the chosen app's icon in the middle of an otherwise empty window.
            ImageView iv = new ImageView(a);
            iv.setImageDrawable(app.icon);
            iv.setAlpha(0.85f);
            box.addView(iv, new FrameLayout.LayoutParams(96, 96, Gravity.CENTER));
            TextView tv = new TextView(a);
            tv.setText(app.label + "\n(long-press to change)");
            tv.setTextColor(Color.argb(200, 255, 255, 255));
            tv.setGravity(Gravity.CENTER);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_PX, 20);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER);
            lp.topMargin = 110;
            box.addView(tv, lp);
        }
        box.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String k = Apps.get(a, key);
                if (k == null) pick(key, false); else Apps.launch(a, k);
            }
        });
        box.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) {
                Apps.showPicker(a, pickTitle, true, new Apps.Picked() {
                    @Override public void onPicked(String k) { Apps.set(a, key, k); a.rebuild(); }
                });
                return true;
            }
        });
    }

    // ------------------------------------------------------------------ time and clock

    private void time(final FrameLayout box, JSONObject vc, JSONObject conf) {
        final String dayFmt = conf == null ? "yyyy/MM/dd" : conf.optString("format", "yyyy/MM/dd");
        final boolean sysAmPm = conf != null && conf.optBoolean("use_system_am_pm", false);
        if (vc == null) vc = t.json(conf == null ? null : conf.optString("config_file_path"));
        forEachAttr(vc, new AttrFn() {
            @Override public void on(String id, JSONObject at) {
                final TextView tv;
                final String pattern;
                switch (id) {
                    case "tv_time_hour": pattern = "HOUR"; break;
                    case "tv_time_day": pattern = dayFmt; break;
                    case "tv_time_week": pattern = "EEEE"; break;
                    case "tv_ap": pattern = "AMPM"; break;
                    default: return;
                }
                tv = text(box, at, "");
                if (tv == null) return;
                tickers.add(new Ticker() {
                    @Override public void tick() {
                        boolean h24 = !sysAmPm || DateFormat.is24HourFormat(a);
                        String p = pattern;
                        if ("HOUR".equals(p)) p = h24 ? "HH:mm" : "hh:mm";
                        if ("AMPM".equals(p)) { tv.setText(h24 ? "" : new SimpleDateFormat("a", Locale.getDefault()).format(new Date())); return; }
                        try { tv.setText(new SimpleDateFormat(p, Locale.getDefault()).format(new Date())); }
                        catch (Exception e) { tv.setText(""); }
                    }
                });
            }
        });
    }

    private void clock(FrameLayout box, JSONObject conf) {
        String hint = conf == null ? "mipmap" : conf.optString("image_path", "mipmap");
        final ClockView cv = new ClockView(a,
                t.drawable(conf == null ? "dial" : conf.optString("dial_name"), hint),
                t.drawable(conf == null ? "hour" : conf.optString("hour_hand_name"), hint),
                t.drawable(conf == null ? "minute" : conf.optString("minute_hand_name"), hint),
                t.drawable(conf == null ? "second" : conf.optString("second_hand_name"), hint));
        box.addView(cv, new FrameLayout.LayoutParams(-1, -1));
        tickers.add(new Ticker() { @Override public void tick() { cv.invalidate(); } });
    }

    // ------------------------------------------------------------------ weather (no data source: shows icon only)

    private void weather(final FrameLayout box, JSONObject vc) {
        forEachAttr(vc, new AttrFn() {
            @Override public void on(String id, JSONObject at) {
                if ("iv_weather_img".equals(id)) image(box, at, t.drawable("weather_day_00", "mipmap"));
                else if ("tv_weather_temp".equals(id)) text(box, at, "--°");
            }
        });
        box.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String k = Apps.guess(a, "weather");
                if (k != null) Apps.launch(a, k);
            }
        });
    }

    // ------------------------------------------------------------------ speed

    private void speedText(final FrameLayout box, JSONObject vc) {
        usesSpeed = true;
        forEachAttr(vc, new AttrFn() {
            @Override public void on(String id, JSONObject at) {
                if ("tv_carspeed_text".equals(id)) {
                    final TextView tv = text(box, at, "0");
                    if (tv != null) speedListeners.add(new SpeedListener() {
                        @Override public void onSpeed(float kmh) { tv.setText(String.valueOf(Math.round(kmh))); }
                    });
                } else if ("tv_carspeed_unit".equals(id)) text(box, at, "km/h");
            }
        });
    }

    private List<Drawable> frames(JSONObject eff) {
        List<Drawable> out = new ArrayList<>();
        String prefix = eff.optString("img_name_prefix"), hint = eff.optString("frame_img_path", "mipmap");
        int n = eff.optInt("frame_img_quantity", 0);
        Drawable zero = t.drawable(prefix + "0", hint);
        int start = zero != null ? 0 : 1;
        for (int i = start; i < start + n; i++) {
            Drawable d = t.drawable(prefix + i, hint);
            if (d != null) out.add(d);
        }
        return out;
    }

    private void speedEffect(FrameLayout box, JSONObject conf) {
        JSONArray effects = conf == null ? null : conf.optJSONArray("effects");
        if (effects == null) return;
        JSONObject driving = null, halt = null;
        for (int i = 0; i < effects.length(); i++) {
            JSONObject e = effects.optJSONObject(i);
            if (e == null) continue;
            if ("driving".equals(e.optString("tag")) || (driving == null && e.optBoolean("open"))) driving = e;
            if ("halt".equals(e.optString("tag"))) halt = e;
        }
        if (driving == null) return;
        usesSpeed = true;
        final List<Drawable> drive = frames(driving);
        final List<Drawable> stop = halt == null ? new ArrayList<Drawable>() : frames(halt);
        final FrameAnimView fa = new FrameAnimView(a, drive, 0);
        box.addView(fa, new FrameLayout.LayoutParams(-1, -1));
        if (!stop.isEmpty()) fa.setImageDrawable(stop.get(0));
        final JSONArray steps = driving.optJSONObject("config") == null ? null : driving.optJSONObject("config").optJSONArray("speed_effect");
        final int defFps = driving.optJSONObject("config") == null ? 5 : driving.optJSONObject("config").optInt("fps", 5);
        speedListeners.add(new SpeedListener() {
            @Override public void onSpeed(float kmh) {
                if (kmh < 2) { fa.setFps(0); if (!stop.isEmpty()) fa.setImageDrawable(stop.get(0)); return; }
                int fps = defFps;
                for (int i = 0; steps != null && i < steps.length(); i++) {
                    JSONObject s = steps.optJSONObject(i);
                    if (s != null && kmh >= s.optInt("speed_threshold")) fps = s.optInt("fps", fps);
                }
                fa.setFps(fps);
            }
        });
    }

    // ------------------------------------------------------------------ media

    private void media(final FrameLayout box, JSONObject vc, final JSONObject conf) {
        final String btnHint = conf == null ? "drawable" : conf.optString("btn_img_path", "drawable");
        final String imgHint = conf == null ? "mipmap" : conf.optString("image_path", "mipmap");
        forEachAttr(vc, new AttrFn() {
            @Override public void on(String id, JSONObject at) {
                if (conf == null) return;
                switch (id) {
                    case "iv_media_icon_bg": image(box, at, t.drawable(conf.optString("media_img_bg"), imgHint)); break;
                    case "iv_media_icon": image(box, at, t.drawable(conf.optString("media_img_name"), imgHint)); break;
                    case "tv_media_name": text(box, at, "Music"); break;
                    case "iv_media_pre": mediaBtn(at, conf.optString("pre_btn_name"), btnHint, KeyEvent.KEYCODE_MEDIA_PREVIOUS); break;
                    case "iv_media_pp": mediaBtn(at, conf.optString("play_btn_name"), btnHint, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); break;
                    case "iv_media_next": mediaBtn(at, conf.optString("next_btn_name"), btnHint, KeyEvent.KEYCODE_MEDIA_NEXT); break;
                    default: break;
                }
            }
            private void mediaBtn(JSONObject at, String name, String hint, final int key) {
                ImageView iv = image(box, at, t.drawable(name, hint));
                if (iv == null) return;
                iv.setClickable(true);
                iv.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View v) { sendMediaKey(key); }
                });
            }
        });
        appCard(box, null, slotKey("music"), "Music app", null, false);
    }

    private void sendMediaKey(int code) {
        AudioManager am = (AudioManager) a.getSystemService(Context.AUDIO_SERVICE);
        long now = SystemClock.uptimeMillis();
        am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_DOWN, code, 0));
        am.dispatchMediaKeyEvent(new KeyEvent(now, now, KeyEvent.ACTION_UP, code, 0));
    }

    // ------------------------------------------------------------------ swipeable pages (theme_config pages)

    static class PagesLayout extends FrameLayout {
        private final List<View> pages = new ArrayList<>();
        private int current = 0;
        private float downX, downY;
        private boolean swiping;
        private final int slop;

        PagesLayout(Context c) {
            super(c);
            slop = ViewConfiguration.get(c).getScaledTouchSlop() * 3;
        }

        void addPage(View v) {
            v.setVisibility(pages.isEmpty() ? VISIBLE : GONE);
            pages.add(v);
            addView(v, new LayoutParams(-1, -1));
        }

        void show(int i) {
            if (pages.size() < 2) return;
            i = (i + pages.size()) % pages.size();
            if (i == current) return;
            final View old = pages.get(current), nu = pages.get(i);
            current = i;
            nu.setAlpha(0f);
            nu.setVisibility(VISIBLE);
            nu.animate().alpha(1f).setDuration(250).start();
            old.animate().alpha(0f).setDuration(250).withEndAction(new Runnable() {
                @Override public void run() { old.setVisibility(GONE); old.setAlpha(1f); }
            }).start();
        }

        @Override public boolean onInterceptTouchEvent(MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: downX = e.getX(); downY = e.getY(); swiping = false; break;
                case MotionEvent.ACTION_MOVE:
                    if (Math.abs(e.getX() - downX) > slop && Math.abs(e.getX() - downX) > Math.abs(e.getY() - downY)) swiping = true;
                    break;
                default: break;
            }
            return swiping;
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN) { downX = e.getX(); downY = e.getY(); return pages.size() > 1; }
            if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                float dx = e.getX() - downX;
                if (Math.abs(dx) > slop) show(current + (dx < 0 ? 1 : -1));
                swiping = false;
            }
            return true;
        }

        /** Only take touches on the page area that actually has content. */
        @Override public boolean dispatchTouchEvent(MotionEvent e) {
            if (e.getActionMasked() == MotionEvent.ACTION_DOWN && !hitsContent(e.getX(), e.getY())) return false;
            return super.dispatchTouchEvent(e);
        }

        private boolean hitsContent(float x, float y) {
            if (pages.isEmpty()) return false;
            View p = pages.get(current);
            if (!(p instanceof FrameLayout)) return true;
            FrameLayout f = (FrameLayout) p;
            for (int i = 0; i < f.getChildCount(); i++) {
                View c = f.getChildAt(i);
                if (x >= c.getLeft() && x < c.getRight() && y >= c.getTop() && y < c.getBottom()) return true;
            }
            return false;
        }
    }

}
