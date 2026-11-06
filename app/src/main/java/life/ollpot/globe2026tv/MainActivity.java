package life.ollpot.globe2026tv;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Full-screen TV app.
 *
 * The TV page (app/src/main/assets) is served at https://globe2026.ollpot.life/__tv/
 * straight from the APK, so it runs on the judging site's own origin: it can read
 * api.php, and YouTube sees a proper https referrer.
 *
 * Video files on the Firestick (Download folder, USB sticks) play in a native
 * ExoPlayer that sits underneath the see-through WebView, so the scoreboard,
 * pop-ups and controls draw on top of it. The page drives it through window.Android.
 */
public class MainActivity extends Activity {
    static final String HOST = "globe2026.ollpot.life";
    static final String START_URL = "https://" + HOST + "/__tv/index.html";
    static final int REQ_FILES = 7;
    static final String[] VIDEO_EXT = {".mp4", ".m4v", ".mkv", ".webm", ".mov", ".ts", ".avi", ".3gp"};

    private FrameLayout root;
    private WebView web;
    private PlayerView playerView;
    private ExoPlayer exo;
    private WebViewAssetLoader assets;
    private volatile String mode = "main";
    private volatile String localState = "{}";
    private String localError = "";
    private final Handler ui = new Handler(Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/__tv/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0c0a0b"));

        playerView = new PlayerView(this);
        playerView.setUseController(false);
        playerView.setFocusable(false);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerView.setShutterBackgroundColor(Color.BLACK);
        playerView.setVisibility(View.GONE);
        root.addView(playerView, new FrameLayout.LayoutParams(1, 1));

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assets.shouldInterceptRequest(Uri.parse(url));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl(START_URL);
        hideSystemUi();
        ui.post(stateTicker);
    }

    private void hideSystemUi() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    /* ---------------- Native video player ---------------- */

    private ExoPlayer exo() {
        if (exo == null) {
            exo = new ExoPlayer.Builder(this).build();
            exo.addListener(new Player.Listener() {
                @Override
                public void onPlayerError(@NonNull PlaybackException error) {
                    localError = error.getErrorCodeName();
                }
            });
            playerView.setPlayer(exo);
        }
        return exo;
    }

    /** Snapshot of the player, refreshed on the main thread for the page to read. */
    private final Runnable stateTicker = new Runnable() {
        @Override
        public void run() {
            try {
                JSONObject o = new JSONObject();
                if (exo != null) {
                    long d = exo.getDuration();
                    o.put("t", exo.getCurrentPosition() / 1000.0);
                    o.put("d", d > 0 ? d / 1000.0 : 0);
                    o.put("buf", d > 0 ? Math.min(1.0, exo.getBufferedPosition() / (double) d) : 0);
                    o.put("playing", exo.isPlaying() || (exo.getPlayWhenReady() && exo.getPlaybackState() == Player.STATE_BUFFERING));
                    o.put("ended", exo.getPlaybackState() == Player.STATE_ENDED);
                    o.put("buffering", exo.getPlaybackState() == Player.STATE_BUFFERING);
                }
                o.put("error", localError);
                localState = o.toString();
            } catch (Exception ignored) { }
            ui.postDelayed(this, 250);
        }
    };

    /* ---------------- Finding videos on the Firestick ---------------- */

    private boolean hasFilePermission() {
        if (Build.VERSION.SDK_INT < 23) return true;
        String p = Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_VIDEO" : Manifest.permission.READ_EXTERNAL_STORAGE;
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    private void askFilePermission() {
        String p = Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_VIDEO" : Manifest.permission.READ_EXTERNAL_STORAGE;
        requestPermissions(new String[]{p}, REQ_FILES);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_FILES) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) scanVideos();
        else sendFiles("{\"denied\":true,\"files\":[]}");
    }

    private void sendFiles(String json) {
        ui.post(() -> web.evaluateJavascript("window.TV&&TV.onFiles(" + JSONObject.quote(json) + ")", null));
    }

    private static boolean isVideo(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        for (String e : VIDEO_EXT) if (n.endsWith(e)) return true;
        return false;
    }

    private void scanVideos() {
        new Thread(() -> {
            JSONArray out = new JSONArray();
            Set<String> seen = new HashSet<>();
            // 1. Android's media library (Download folder, most USB sticks).
            try (Cursor c = getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    new String[]{MediaStore.Video.Media.DATA, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.SIZE},
                    null, null, MediaStore.Video.Media.DATE_MODIFIED + " DESC")) {
                if (c != null) while (c.moveToNext()) {
                    String path = c.getString(0);
                    if (path != null && new File(path).exists()) add(out, seen, new File(path));
                }
            } catch (Exception ignored) { }
            // 2. Walk storage directly, in case the media library hasn't caught up yet.
            walk(Environment.getExternalStorageDirectory(), 0, out, seen);
            File[] vols = new File("/storage").listFiles();
            if (vols != null) for (File v : vols) {
                String n = v.getName();
                if (!n.equals("emulated") && !n.equals("self")) walk(v, 0, out, seen);
            }
            try {
                JSONObject res = new JSONObject();
                res.put("files", out);
                sendFiles(res.toString());
            } catch (Exception e) {
                sendFiles("{\"files\":[]}");
            }
        }).start();
    }

    private void walk(File dir, int depth, JSONArray out, Set<String> seen) {
        if (dir == null || depth > 4 || out.length() > 300) return;
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            String n = f.getName();
            if (n.startsWith(".")) continue;
            if (f.isDirectory()) {
                if (depth == 0 && n.equals("Android")) continue;
                walk(f, depth + 1, out, seen);
            } else if (isVideo(n)) add(out, seen, f);
        }
    }

    private void add(JSONArray out, Set<String> seen, File f) {
        try {
            String path = f.getCanonicalPath();
            if (!seen.add(path) || !isVideo(f.getName())) return;
            JSONObject o = new JSONObject();
            o.put("path", path);
            o.put("name", f.getName());
            o.put("size", f.length());
            o.put("folder", f.getParentFile() != null ? f.getParentFile().getName() : "");
            out.put(o);
        } catch (Exception ignored) { }
    }

    /* ---------------- Remote control ---------------- */

    private static String keyName(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER: return "ok";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "playpause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "pause";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "rew";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "ff";
            case KeyEvent.KEYCODE_MENU: return "menu";
            case KeyEvent.KEYCODE_BACK: return "back";
            default: return null;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String name = keyName(event.getKeyCode());
        if (name == null) return super.dispatchKeyEvent(event);
        // In the events menu the D-pad and OK go to the page itself, so text boxes
        // and buttons behave normally. Everything else is sent straight to the page.
        boolean menuNav = "menu".equals(mode) && (name.equals("up") || name.equals("down")
                || name.equals("left") || name.equals("right") || name.equals("ok"));
        if (menuNav) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            web.evaluateJavascript("window.TV&&TV.key('" + name + "')", null);
        }
        return true;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("window.TV&&TV.key('pause')", null);
        if (exo != null) exo.pause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(stateTicker);
        if (exo != null) exo.release();
        web.destroy();
        super.onDestroy();
    }

    /** Called from the page as window.Android.* (on a background thread). */
    class Bridge {
        @JavascriptInterface
        public void setMode(String m) {
            mode = m == null ? "main" : m;
            runOnUiThread(() -> web.requestFocus());
        }

        @JavascriptInterface
        public void exitApp() { runOnUiThread(MainActivity.this::finish); }

        @JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(() -> {
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
            });
        }

        @JavascriptInterface
        public void openYouTube(String videoId) {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:" + videoId)));
                } catch (ActivityNotFoundException e) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=" + videoId)));
                }
            });
        }

        @JavascriptInterface
        public boolean hasNativePlayer() { return true; }

        @JavascriptInterface
        public void listVideos() {
            runOnUiThread(() -> { if (hasFilePermission()) scanVideos(); else askFilePermission(); });
        }

        @JavascriptInterface
        public void localPlay(String path, double startSeconds) {
            runOnUiThread(() -> {
                localError = "";
                ExoPlayer p = exo();
                p.setMediaItem(MediaItem.fromUri(Uri.fromFile(new File(path))));
                p.prepare();
                if (startSeconds > 0) p.seekTo((long) (startSeconds * 1000));
                p.setPlayWhenReady(true);
                playerView.setVisibility(View.VISIBLE);
            });
        }

        @JavascriptInterface
        public void localPause() { runOnUiThread(() -> { if (exo != null) exo.pause(); }); }

        @JavascriptInterface
        public void localResume() { runOnUiThread(() -> { if (exo != null) exo.play(); }); }

        @JavascriptInterface
        public void localSeek(double seconds) {
            runOnUiThread(() -> { if (exo != null) exo.seekTo((long) (Math.max(0, seconds) * 1000)); });
        }

        @JavascriptInterface
        public void localStop() {
            runOnUiThread(() -> {
                if (exo != null) { exo.stop(); exo.clearMediaItems(); }
                playerView.setVisibility(View.GONE);
            });
        }

        @JavascriptInterface
        public String localState() { return localState; }

        /** Where the video should sit, in CSS pixels (1 CSS px = 1 dp here). */
        @JavascriptInterface
        public void setVideoRect(double x, double y, double w, double h) {
            runOnUiThread(() -> {
                float dp = getResources().getDisplayMetrics().density;
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                        Math.max(1, (int) Math.round(w * dp)), Math.max(1, (int) Math.round(h * dp)));
                lp.leftMargin = (int) Math.round(x * dp);
                lp.topMargin = (int) Math.round(y * dp);
                playerView.setLayoutParams(lp);
            });
        }
    }
}
