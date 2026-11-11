package com.carthemes.launcher;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A "variety theme" plugin APK (package launcher.variety.theme.plugin.*), loaded as plain
 * resources and assets. No code from the theme is ever executed.
 */
public class Theme {
    public static final String META_KEY = "launcher.variety.theme.plugin";
    private static final String TAG = "CarTheme";

    public final String pkg;
    public final String label;
    public final Resources res;
    public final AssetManager assets;
    /** "assets" folder prefix for the chosen screen size, e.g. "layout-1600x720/" or "". */
    public final String layoutDir;
    public final int designW, designH;

    private final Map<String, Typeface> fonts = new HashMap<>();
    private final Map<String, Integer> idCache = new HashMap<>();

    public static class Info {
        public final String pkg, label;
        Info(String pkg, String label) { this.pkg = pkg; this.label = label; }
        @Override public String toString() { return label; }
    }

    /** All installed theme plugins. */
    public static List<Info> findInstalled(Context ctx) {
        List<Info> out = new ArrayList<>();
        PackageManager pm = ctx.getPackageManager();
        for (ApplicationInfo ai : pm.getInstalledApplications(PackageManager.GET_META_DATA)) {
            if (ai.metaData != null && ai.metaData.containsKey(META_KEY)) {
                String label = ai.packageName.substring(ai.packageName.lastIndexOf('.') + 1);
                try {
                    Context tc = ctx.createPackageContext(ai.packageName, 0);
                    Resources r = tc.getResources();
                    int id = r.getIdentifier("theme_name", "string", ai.packageName);
                    if (id != 0) label = r.getString(id);
                } catch (Exception ignored) { }
                out.add(new Info(ai.packageName, label));
            }
        }
        return out;
    }

    /**
     * @param night null = follow the system, true/false = force night/day.
     */
    public static Theme load(Context ctx, String pkg, Boolean night, int screenW, int screenH) throws Exception {
        Context tc = ctx.createPackageContext(pkg, 0);
        Configuration conf = new Configuration(ctx.getResources().getConfiguration());
        if (night != null) {
            conf.uiMode = (conf.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
                    | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
        }
        Context cc = tc.createConfigurationContext(conf);
        Resources res = cc.getResources();
        AssetManager am = tc.getAssets();

        String label = pkg;
        int nameId = res.getIdentifier("theme_name", "string", pkg);
        if (nameId != 0) label = res.getString(nameId);

        // Pick the layout folder that best matches the screen: exact size, else same aspect ratio, else default.
        String best = "";
        int bw = 1024, bh = 600;
        double target = (double) screenW / screenH, bestScore = Double.MAX_VALUE;
        String[] top = am.list("");
        boolean defaultExists = Arrays.asList(top).contains("hotseat_config.json");
        if (defaultExists) bestScore = Math.abs(target - 1024.0 / 600) * 10 + 1;
        for (String d : top) {
            if (!d.startsWith("layout-")) continue;
            String[] wh = d.substring(7).split("x");
            if (wh.length != 2) continue;
            try {
                int w = Integer.parseInt(wh[0]), h = Integer.parseInt(wh[1]);
                if (!exists(am, d + "/hotseat_config.json")) continue;
                double score = Math.abs(target - (double) w / h) * 10 + Math.abs(screenW - w) / 10000.0;
                if (w == screenW && h == screenH) score = -1;
                if (score < bestScore) { bestScore = score; best = d + "/"; bw = w; bh = h; }
            } catch (NumberFormatException ignored) { }
        }
        return new Theme(pkg, label, res, am, best, bw, bh);
    }

    private Theme(String pkg, String label, Resources res, AssetManager assets, String layoutDir, int w, int h) {
        this.pkg = pkg; this.label = label; this.res = res; this.assets = assets;
        this.layoutDir = layoutDir; this.designW = w; this.designH = h;
    }

    private static boolean exists(AssetManager am, String path) {
        try (InputStream in = am.open(path)) { return true; } catch (Exception e) { return false; }
    }

    /** Reads a JSON file relative to the layout folder (falls back to the default folder). */
    public JSONObject json(String rel) {
        if (rel == null || rel.isEmpty()) return null;
        if (!rel.endsWith(".json")) rel = rel + ".json";
        for (String p : new String[]{layoutDir + rel, rel}) {
            try (InputStream in = assets.open(p)) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                String s = new String(bo.toByteArray(), "UTF-8").trim();
                if (s.startsWith("﻿")) s = s.substring(1);
                return new JSONObject(s);
            } catch (java.io.FileNotFoundException e) {
                // try next
            } catch (Exception e) {
                Log.w(TAG, "Bad JSON " + p, e);
                return null;
            }
        }
        return null;
    }

    private int resId(String name, String type) {
        String k = type + "/" + name;
        Integer v = idCache.get(k);
        if (v == null) { v = res.getIdentifier(name, type, pkg); idCache.put(k, v); }
        return v;
    }

    public boolean hasImage(String name) {
        return name != null && !name.isEmpty() && (resId(name, "mipmap") != 0 || resId(name, "drawable") != 0);
    }

    /** Image by name; looks in the hinted folder type first ("mipmap" or "drawable"). */
    public Drawable drawable(String name, String hint) {
        if (name == null || name.isEmpty()) return null;
        int dot = name.lastIndexOf('.');
        if (dot > 0) name = name.substring(0, dot);
        String[] order = "drawable".equals(hint) ? new String[]{"drawable", "mipmap"} : new String[]{"mipmap", "drawable"};
        for (String t : order) {
            int id = resId(name, t);
            if (id != 0) {
                try { return res.getDrawable(id, null); } catch (Exception e) { Log.w(TAG, "drawable " + name, e); }
            }
        }
        return null;
    }

    /** "#AARRGGBB", "#RRGGBB" or "@color/name". */
    public int color(String spec, int def) {
        if (spec == null || spec.isEmpty()) return def;
        try {
            if (spec.startsWith("@color/")) {
                int id = resId(spec.substring(7), "color");
                return id != 0 ? res.getColor(id, null) : def;
            }
            return Color.parseColor(spec);
        } catch (Exception e) { return def; }
    }

    public Typeface font(String path) {
        if (path == null || path.isEmpty()) return null;
        if (fonts.containsKey(path)) return fonts.get(path);
        Typeface tf = null;
        try { tf = Typeface.createFromAsset(assets, path); } catch (Exception e) { Log.w(TAG, "font " + path); }
        fonts.put(path, tf);
        return tf;
    }
}
