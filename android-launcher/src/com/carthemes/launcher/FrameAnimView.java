package com.carthemes.launcher;

import android.content.Context;
import android.graphics.drawable.Drawable;
import android.widget.ImageView;

import java.util.List;

/** Plays a list of frames (e.g. car_effect_driving_0..N). Frames per second can change with speed. */
class FrameAnimView extends ImageView {
    private final List<Drawable> frames;
    private int index = 0;
    private int fps;
    private boolean running;

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running || frames.isEmpty()) return;
            index = (index + 1) % frames.size();
            setImageDrawable(frames.get(index));
            postDelayed(this, 1000 / Math.max(1, fps));
        }
    };

    FrameAnimView(Context c, List<Drawable> frames, int fps) {
        super(c);
        this.frames = frames;
        this.fps = fps;
        setScaleType(ScaleType.FIT_XY);
        if (!frames.isEmpty()) setImageDrawable(frames.get(0));
    }

    void setFps(int fps) { this.fps = fps; if (fps <= 0) stop(); else start(); }

    void start() {
        if (running || frames.size() < 2 || fps <= 0) return;
        running = true;
        postDelayed(tick, 1000 / fps);
    }

    void stop() { running = false; removeCallbacks(tick); }

    @Override protected void onDetachedFromWindow() { stop(); super.onDetachedFromWindow(); }
}
