package com.carthemes.launcher;

import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import org.json.JSONObject;

/** Converts theme sizes and gravity strings ("l_7|t_74", "right|r_265|t_45", "center") to FrameLayout params. */
final class Geo {
    private Geo() { }

    static FrameLayout.LayoutParams params(JSONObject o) {
        int w = size(o.optInt("width", -2));
        int h = size(o.optInt("height", -2));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, h);
        apply(lp, o.optString("gravity", ""));
        return lp;
    }

    private static int size(int v) {
        if (v == -1) return ViewGroup.LayoutParams.MATCH_PARENT;
        if (v == -2) return ViewGroup.LayoutParams.WRAP_CONTENT;
        return Math.max(0, v);
    }

    static void apply(FrameLayout.LayoutParams lp, String g) {
        int hg = Gravity.LEFT, vg = Gravity.TOP;
        boolean hSet = false, vSet = false;
        Integer l = null, r = null, t = null, b = null;
        for (String raw : g.split("\\|")) {
            String tok = raw.trim();
            if (tok.isEmpty()) continue;
            try {
                if (tok.startsWith("l_")) l = Integer.parseInt(tok.substring(2));
                else if (tok.startsWith("r_")) r = Integer.parseInt(tok.substring(2));
                else if (tok.startsWith("t_")) t = Integer.parseInt(tok.substring(2));
                else if (tok.startsWith("b_")) b = Integer.parseInt(tok.substring(2));
            } catch (NumberFormatException ignored) { }
            switch (tok) {
                case "left": hg = Gravity.LEFT; hSet = true; break;
                case "right": hg = Gravity.RIGHT; hSet = true; break;
                case "top": vg = Gravity.TOP; vSet = true; break;
                case "bottom": vg = Gravity.BOTTOM; vSet = true; break;
                case "center_horizontal": hg = Gravity.CENTER_HORIZONTAL; hSet = true; break;
                case "center_vertical": vg = Gravity.CENTER_VERTICAL; vSet = true; break;
                case "center": hg = Gravity.CENTER_HORIZONTAL; vg = Gravity.CENTER_VERTICAL; hSet = vSet = true; break;
                default: break;
            }
        }
        if (!hSet && r != null && l == null) hg = Gravity.RIGHT;
        if (!vSet && b != null && t == null) vg = Gravity.BOTTOM;
        lp.gravity = hg | vg;
        lp.leftMargin = l == null ? 0 : l;
        lp.rightMargin = r == null ? 0 : r;
        lp.topMargin = t == null ? 0 : t;
        lp.bottomMargin = b == null ? 0 : b;
    }
}
