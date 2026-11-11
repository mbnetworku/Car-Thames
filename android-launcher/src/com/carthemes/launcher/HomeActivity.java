package com.carthemes.launcher;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class HomeActivity extends Activity {
    private static final String TAG = "CarLauncher";

    private FrameLayout host;
    private Widgets widgets;
    private Theme theme;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean resumed;
    private float lastSpeed = 0;
    private long lastFix = 0;

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (widgets != null) for (Widgets.Ticker t : widgets.tickers) t.tick();
            // No GPS fix for 5 s: assume stopped.
            if (lastFix != 0 && System.currentTimeMillis() - lastFix > 5000 && lastSpeed != 0) pushSpeed(0);
            if (resumed) handler.postDelayed(this, 1000);
        }
    };

    private final LocationListener gps = new LocationListener() {
        @Override public void onLocationChanged(Location l) {
            lastFix = System.currentTimeMillis();
            pushSpeed(l.hasSpeed() ? l.getSpeed() * 3.6f : 0);
        }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
    };

    private final BroadcastReceiver packages = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { rebuild(); }
    };

    // ------------------------------------------------------------------ lifecycle

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        host = new FrameLayout(this);
        host.setBackgroundColor(Color.BLACK);
        setContentView(host);
        host.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { showSettings(); return true; }
        });
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_REPLACED);
        f.addDataScheme("package");
        registerReceiver(packages, f);
        rebuild();
    }

    @Override protected void onDestroy() {
        try { unregisterReceiver(packages); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        handler.removeCallbacks(ticker);
        handler.post(ticker);
        startGps();
    }

    @Override protected void onPause() {
        resumed = false;
        handler.removeCallbacks(ticker);
        stopGps();
        super.onPause();
    }

    @Override public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        rebuild(); // day/night switch, rotation, screen size
    }

    @Override public void onBackPressed() { /* home screen: nothing to go back to */ }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        startGps();
    }

    // ------------------------------------------------------------------ settings in prefs

    SharedPreferences prefs() { return Apps.prefs(this); }

    boolean useThemeIcons() { return prefs().getBoolean("theme_icons", true); }

    private Boolean nightSetting() {
        String n = prefs().getString("night", "auto");
        if ("day".equals(n)) return Boolean.FALSE;
        if ("night".equals(n)) return Boolean.TRUE;
        return null;
    }

    // ------------------------------------------------------------------ building the screen

    void rebuild() {
        host.removeAllViews();
        widgets = null;
        theme = null;
        List<Theme.Info> themes = Theme.findInstalled(this);
        String chosen = prefs().getString("theme", null);
        Theme.Info info = null;
        for (Theme.Info ti : themes) if (ti.pkg.equals(chosen)) info = ti;
        if (info == null && !themes.isEmpty()) info = themes.get(0);
        if (info == null) { showNoTheme(); return; }

        DisplayMetrics dm = new DisplayMetrics();
        getWindowManager().getDefaultDisplay().getRealMetrics(dm);
        try {
            theme = Theme.load(this, info.pkg, nightSetting(), dm.widthPixels, dm.heightPixels);
            widgets = new Widgets(this, theme);
            FrameLayout screen = widgets.build();
            // The theme is drawn at its design size and scaled to fill this screen.
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(theme.designW, theme.designH);
            screen.setPivotX(0);
            screen.setPivotY(0);
            screen.setScaleX((float) dm.widthPixels / theme.designW);
            screen.setScaleY((float) dm.heightPixels / theme.designH);
            host.addView(screen, lp);
            for (Widgets.Ticker t : widgets.tickers) t.tick();
            for (Widgets.SpeedListener s : widgets.speedListeners) s.onSpeed(lastSpeed);
            startGps();
        } catch (Throwable e) {
            Log.e(TAG, "Theme failed", e);
            showError(info, e);
        }
    }

    private LinearLayout messageBox(String title, String body) {
        LinearLayout ll = new LinearLayout(this);
        ll.setOrientation(LinearLayout.VERTICAL);
        ll.setGravity(Gravity.CENTER);
        ll.setPadding(48, 48, 48, 48);
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextSize(28);
        t.setTextColor(Color.WHITE);
        t.setGravity(Gravity.CENTER);
        ll.addView(t);
        TextView b = new TextView(this);
        b.setText(body);
        b.setTextSize(16);
        b.setTextColor(Color.LTGRAY);
        b.setGravity(Gravity.CENTER);
        b.setPadding(0, 24, 0, 24);
        ll.addView(b);
        return ll;
    }

    private Button button(LinearLayout row, String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setOnClickListener(l);
        row.addView(b);
        return b;
    }

    private void showNoTheme() {
        LinearLayout ll = messageBox("Car Launcher",
                "No theme installed yet.\nInstall a theme APK made with Car Theme Studio (or an original variety theme), "
                        + "then come back here.");
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER);
        button(row, "All apps", new View.OnClickListener() { @Override public void onClick(View v) { Apps.showDrawer(HomeActivity.this); } });
        button(row, "Settings", new View.OnClickListener() { @Override public void onClick(View v) { showSettings(); } });
        ll.addView(row);
        host.addView(ll, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showError(Theme.Info info, Throwable e) {
        LinearLayout ll = messageBox("Theme could not be loaded", info.label + "\n" + e);
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER);
        button(row, "All apps", new View.OnClickListener() { @Override public void onClick(View v) { Apps.showDrawer(HomeActivity.this); } });
        button(row, "Choose theme", new View.OnClickListener() { @Override public void onClick(View v) { chooseTheme(); } });
        ll.addView(row);
        host.addView(ll, new FrameLayout.LayoutParams(-1, -1));
    }

    // ------------------------------------------------------------------ GPS speed

    private void startGps() {
        if (!resumed || widgets == null || !widgets.usesSpeed) return;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            if (!prefs().getBoolean("asked_location", false)) {
                prefs().edit().putBoolean("asked_location", true).apply();
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, 1);
            }
            return;
        }
        try {
            LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            lm.removeUpdates(gps);
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, gps, Looper.getMainLooper());
        } catch (Exception e) { Log.w(TAG, "GPS", e); }
    }

    private void stopGps() {
        try { ((LocationManager) getSystemService(LOCATION_SERVICE)).removeUpdates(gps); } catch (Exception ignored) { }
    }

    private void pushSpeed(float kmh) {
        lastSpeed = kmh;
        if (widgets != null) for (Widgets.SpeedListener s : widgets.speedListeners) s.onSpeed(kmh);
    }

    // ------------------------------------------------------------------ settings menu

    void showSettings() {
        final String night = prefs().getString("night", "auto");
        final List<String> items = new ArrayList<>();
        final List<Runnable> actions = new ArrayList<>();
        items.add("Theme: " + (theme != null ? theme.label : "none") + "  (" + Theme.findInstalled(this).size() + " installed)");
        actions.add(new Runnable() { @Override public void run() { chooseTheme(); } });
        items.add("Day / night: " + night);
        actions.add(new Runnable() { @Override public void run() { chooseNight(); } });
        items.add("Themed app icons: " + (useThemeIcons() ? "on" : "off"));
        actions.add(new Runnable() { @Override public void run() {
            prefs().edit().putBoolean("theme_icons", !useThemeIcons()).apply(); rebuild(); } });
        items.add("All apps");
        actions.add(new Runnable() { @Override public void run() { Apps.showDrawer(HomeActivity.this); } });
        items.add("Reset app shortcuts");
        actions.add(new Runnable() { @Override public void run() {
            Apps.confirm(HomeActivity.this, "Remove all app shortcuts and fill them with defaults again?", new Runnable() {
                @Override public void run() {
                    Apps.clearSlots(HomeActivity.this);
                    SharedPreferences.Editor e = prefs().edit();
                    for (String k : prefs().getAll().keySet()) if (k.startsWith("seeded:")) e.remove(k);
                    e.apply();
                    rebuild();
                }
            }); } });
        items.add("Make Car Launcher the default home screen");
        actions.add(new Runnable() { @Override public void run() { openSettings(Settings.ACTION_HOME_SETTINGS); } });
        items.add("Android settings");
        actions.add(new Runnable() { @Override public void run() { openSettings(Settings.ACTION_SETTINGS); } });
        items.add("About");
        actions.add(new Runnable() { @Override public void run() {
            String msg = "Car Launcher 1.0\n\nShows home screens from variety theme APKs.\n"
                    + (theme != null ? "\nTheme: " + theme.label + "\nPackage: " + theme.pkg + "\nLayout: "
                    + (theme.layoutDir.isEmpty() ? "default (1024x600)" : theme.layoutDir) : "")
                    + "\n\nTips:\n• Long-press an app slot to change the app\n• Long-press an empty area for this menu\n• Swipe the left card to change pages";
            new AlertDialog.Builder(HomeActivity.this, android.R.style.Theme_Material_Dialog_Alert).setMessage(msg).setPositiveButton("OK", null).show();
        } });
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Car Launcher")
                .setItems(items.toArray(new String[0]), new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) { actions.get(which).run(); }
                }).show();
    }

    private void openSettings(String action) {
        try { startActivity(new Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
            catch (Exception e2) { Toast.makeText(this, "Settings not available", Toast.LENGTH_SHORT).show(); }
        }
    }

    private void chooseTheme() {
        final List<Theme.Info> themes = Theme.findInstalled(this);
        if (themes.isEmpty()) { Toast.makeText(this, "No themes installed", Toast.LENGTH_LONG).show(); return; }
        String[] names = new String[themes.size()];
        int sel = -1;
        String cur = theme != null ? theme.pkg : null;
        for (int i = 0; i < names.length; i++) {
            names[i] = themes.get(i).label + "\n" + themes.get(i).pkg;
            if (themes.get(i).pkg.equals(cur)) sel = i;
        }
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert).setTitle("Choose theme")
                .setSingleChoiceItems(names, sel, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        prefs().edit().putString("theme", themes.get(which).pkg).apply();
                        d.dismiss();
                        rebuild();
                    }
                }).show();
    }

    private void chooseNight() {
        final String[] keys = {"auto", "day", "night"};
        String[] labels = {"Auto (follow the car / system)", "Always day", "Always night"};
        int sel = java.util.Arrays.asList(keys).indexOf(prefs().getString("night", "auto"));
        new AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert).setTitle("Day / night")
                .setSingleChoiceItems(labels, sel, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        prefs().edit().putString("night", keys[which]).apply();
                        d.dismiss();
                        rebuild();
                    }
                }).show();
    }
}
