package com.carthemes.launcher;

import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Installed apps, the app picker, the app drawer and the saved slot assignments. */
final class Apps {
    static final String ALL_APPS = "@all_apps";
    static final String SETTINGS = "@launcher_settings";

    private Apps() { }

    static class App {
        final String key;      // flattened ComponentName, or a special "@..." key
        final String label;
        final Drawable icon;
        App(String key, String label, Drawable icon) { this.key = key; this.label = label; this.icon = icon; }
    }

    interface Picked { void onPicked(String key); }

    static List<App> launchable(Context c) { return launchable(c, true); }

    static List<App> launchable(Context c, boolean icons) {
        PackageManager pm = c.getPackageManager();
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<App> out = new ArrayList<>();
        for (ResolveInfo ri : pm.queryIntentActivities(i, 0)) {
            if (ri.activityInfo.packageName.equals(c.getPackageName())) continue;
            ComponentName cn = new ComponentName(ri.activityInfo.packageName, ri.activityInfo.name);
            out.add(new App(cn.flattenToString(), String.valueOf(ri.loadLabel(pm)), icons ? ri.loadIcon(pm) : null));
        }
        final Collator col = Collator.getInstance(Locale.getDefault());
        Collections.sort(out, new Comparator<App>() {
            @Override public int compare(App a, App b) { return col.compare(a.label, b.label); }
        });
        return out;
    }

    // -------------------------------------------------------------- saved slots

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("launcher", Context.MODE_PRIVATE); }

    static String get(Context c, String slot) { return prefs(c).getString("slot:" + slot, null); }

    static void set(Context c, String slot, String key) {
        SharedPreferences.Editor e = prefs(c).edit();
        if (key == null) e.remove("slot:" + slot); else e.putString("slot:" + slot, key);
        e.apply();
    }

    static void clearSlots(Context c) {
        SharedPreferences p = prefs(c);
        SharedPreferences.Editor e = p.edit();
        for (String k : p.getAll().keySet()) if (k.startsWith("slot:")) e.remove(k);
        e.apply();
    }

    /** Label and icon for a saved key (null if the app was uninstalled). */
    static App resolve(Context c, String key) {
        if (key == null) return null;
        if (ALL_APPS.equals(key)) return new App(key, "Apps", null);
        if (SETTINGS.equals(key)) return new App(key, "Launcher", null);
        try {
            ComponentName cn = ComponentName.unflattenFromString(key);
            PackageManager pm = c.getPackageManager();
            android.content.pm.ActivityInfo ai = pm.getActivityInfo(cn, 0);
            return new App(key, String.valueOf(ai.loadLabel(pm)), ai.loadIcon(pm));
        } catch (Exception e) { return null; }
    }

    static void launch(HomeActivity a, String key) {
        if (key == null) return;
        if (ALL_APPS.equals(key)) { showDrawer(a); return; }
        if (SETTINGS.equals(key)) { a.showSettings(); return; }
        try {
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    .setComponent(ComponentName.unflattenFromString(key))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            a.startActivity(i);
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(a, "App not available", Toast.LENGTH_SHORT).show();
        }
    }

    /** Best guess at a default app for a widget, e.g. a maps app for "navi". */
    private static List<App> guessCache;
    private static long guessTime;

    static String guess(Context c, String... needles) {
        if (guessCache == null || System.currentTimeMillis() - guessTime > 10000) {
            guessCache = launchable(c, false);
            guessTime = System.currentTimeMillis();
        }
        for (App a : guessCache) {
            String s = (a.key + " " + a.label).toLowerCase(Locale.ROOT);
            for (String n : needles) if (s.contains(n)) return a.key;
        }
        return null;
    }

    // -------------------------------------------------------------- UI

    static void showPicker(final HomeActivity a, String title, boolean allowEmpty, final Picked cb) {
        final List<App> apps = new ArrayList<>();
        apps.add(new App(ALL_APPS, "All apps (drawer)", null));
        if (allowEmpty) apps.add(new App(null, "Empty slot", null));
        apps.addAll(launchable(a));
        final Dialog d = new Dialog(a, android.R.style.Theme_Material_Dialog);
        d.setTitle(title);
        GridView g = grid(a, apps, 4);
        d.setContentView(g);
        g.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> p, View v, int pos, long id) {
                d.dismiss();
                cb.onPicked(apps.get(pos).key);
            }
        });
        d.show();
        Window w = d.getWindow();
        if (w != null) w.setLayout((int) (a.getResources().getDisplayMetrics().widthPixels * 0.7), (int) (a.getResources().getDisplayMetrics().heightPixels * 0.85));
    }

    static void showDrawer(final HomeActivity a) {
        final List<App> apps = launchable(a);
        final Dialog d = new Dialog(a, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        LinearLayout root = new LinearLayout(a);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.argb(235, 10, 14, 20));
        TextView title = new TextView(a);
        title.setText("All apps   (tap to open · long-press for app info · back to close)");
        title.setTextColor(Color.LTGRAY);
        title.setPadding(32, 24, 32, 8);
        root.addView(title);
        int cols = Math.max(4, a.getResources().getDisplayMetrics().widthPixels / 200);
        GridView g = grid(a, apps, cols);
        root.addView(g, new LinearLayout.LayoutParams(-1, 0, 1));
        d.setContentView(root);
        g.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> p, View v, int pos, long id) { d.dismiss(); launch(a, apps.get(pos).key); }
        });
        g.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override public boolean onItemLongClick(AdapterView<?> p, View v, int pos, long id) {
                ComponentName cn = ComponentName.unflattenFromString(apps.get(pos).key);
                Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        android.net.Uri.parse("package:" + cn.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { a.startActivity(i); d.dismiss(); } catch (Exception ignored) { }
                return true;
            }
        });
        Window w = d.getWindow();
        if (w != null) w.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        d.show();
    }

    private static GridView grid(final Context c, final List<App> apps, int cols) {
        GridView g = new GridView(c);
        g.setNumColumns(cols);
        g.setVerticalSpacing(12);
        g.setPadding(16, 16, 16, 16);
        g.setAdapter(new BaseAdapter() {
            @Override public int getCount() { return apps.size(); }
            @Override public Object getItem(int i) { return apps.get(i); }
            @Override public long getItemId(int i) { return i; }
            @Override public View getView(int i, View v, ViewGroup parent) {
                LinearLayout ll;
                if (v instanceof LinearLayout) ll = (LinearLayout) v;
                else {
                    ll = new LinearLayout(c);
                    ll.setOrientation(LinearLayout.VERTICAL);
                    ll.setGravity(Gravity.CENTER_HORIZONTAL);
                    ll.setPadding(8, 8, 8, 8);
                    ImageView iv = new ImageView(c);
                    ll.addView(iv, new LinearLayout.LayoutParams(96, 96));
                    TextView tv = new TextView(c);
                    tv.setTextColor(Color.WHITE);
                    tv.setGravity(Gravity.CENTER);
                    tv.setMaxLines(2);
                    tv.setTextSize(14);
                    ll.addView(tv);
                }
                App app = apps.get(i);
                ImageView iv = (ImageView) ll.getChildAt(0);
                if (app.icon != null) iv.setImageDrawable(app.icon);
                else iv.setImageResource(app.key == null ? android.R.drawable.ic_menu_close_clear_cancel : android.R.drawable.ic_dialog_dialer);
                ((TextView) ll.getChildAt(1)).setText(app.label);
                return ll;
            }
        });
        return g;
    }

    static void confirm(Context c, String msg, final Runnable ok) {
        new AlertDialog.Builder(c, android.R.style.Theme_Material_Dialog_Alert).setMessage(msg)
                .setPositiveButton("OK", new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface d, int w) { ok.run(); }
                }).setNegativeButton("Cancel", null).show();
    }
}
