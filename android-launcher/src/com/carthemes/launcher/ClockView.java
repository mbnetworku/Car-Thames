package com.carthemes.launcher;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.drawable.Drawable;
import android.view.View;

import java.util.Calendar;

/** Analog clock drawn from the theme's dial and hand images (falls back to plain lines). */
class ClockView extends View {
    private final Drawable dial, hour, minute, second;
    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

    ClockView(Context c, Drawable dial, Drawable hour, Drawable minute, Drawable second) {
        super(c);
        this.dial = dial; this.hour = hour; this.minute = minute; this.second = second;
        p.setColor(Color.WHITE);
        p.setStrokeCap(Paint.Cap.ROUND);
    }

    @Override protected void onDraw(Canvas c) {
        int w = getWidth(), h = getHeight();
        float cx = w / 2f, cy = h / 2f, rad = Math.min(w, h) / 2f;
        Calendar now = Calendar.getInstance();
        float s = now.get(Calendar.SECOND);
        float m = now.get(Calendar.MINUTE) + s / 60f;
        float hr = (now.get(Calendar.HOUR) + m / 60f);
        if (dial != null) { dial.setBounds(0, 0, w, h); dial.draw(c); }
        hand(c, hour, hr * 30, cx, cy, rad * 0.5f, rad * 0.06f, w, h);
        hand(c, minute, m * 6, cx, cy, rad * 0.75f, rad * 0.04f, w, h);
        hand(c, second, s * 6, cx, cy, rad * 0.85f, rad * 0.02f, w, h);
    }

    private void hand(Canvas c, Drawable d, float deg, float cx, float cy, float len, float width, int w, int h) {
        c.save();
        c.rotate(deg, cx, cy);
        if (d != null) {
            // Hand images are drawn full-size, pointing to 12 o'clock, centered on the dial.
            d.setBounds(0, 0, w, h);
            d.draw(c);
        } else {
            p.setStrokeWidth(Math.max(2, width));
            c.drawLine(cx, cy, cx, cy - len, p);
        }
        c.restore();
    }
}
