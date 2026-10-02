package com.itp.notice;

import android.Manifest;
import android.content.Intent;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.*;
import java.util.concurrent.*;

@CapacitorPlugin(name = "NoticeInput", permissions = {
    @Permission(alias = "images", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
    @Permission(alias = "selected", strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }),
    @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
    @Permission(alias = "write", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
})
public class NoticeInputPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Set<String> readable = ConcurrentHashMap.newKeySet();

    @Override public void load() { receive(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { receive(intent); }

    @SuppressWarnings("deprecation")
    private void receive(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction(), type = intent.getType();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        JSObject payload = new JSObject();
        payload.put("id", UUID.randomUUID().toString());
        JSArray images = new JSArray();
        if (type != null && type.startsWith("image/")) {
            ArrayList<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (streams != null) uris.addAll(streams);
            } else {
                Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) uris.add(stream);
            }
            if (intent.getClipData() != null) {
                for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                    Uri uri = intent.getClipData().getItemAt(i).getUri();
                    if (uri != null) uris.add(uri);
                }
            }
            for (Uri uri : new LinkedHashSet<>(uris)) {
                if (!"content".equals(uri.getScheme())) continue;
                readable.add(uri.toString());
                images.put(uri.toString());
            }
        }
        payload.put("images", images);
        CharSequence text = "text/plain".equals(type) ? intent.getCharSequenceExtra(Intent.EXTRA_TEXT) : null;
        payload.put("text", text == null ? "" : text.toString());
        // Retain cold-start events until the WebView has installed its listener.
        if (images.length() > 0 || text != null) notifyListeners("sharedNotice", payload, true);
        intent.setAction(Intent.ACTION_MAIN); // Activity recreation must not import the same share twice.
    }

    private boolean imageAccess() {
        return getPermissionState(Build.VERSION.SDK_INT >= 33 ? "images" : "storage") == PermissionState.GRANTED
            || (Build.VERSION.SDK_INT >= 34 && getPermissionState("selected") == PermissionState.GRANTED);
    }

    @PluginMethod public void recentScreenshots(PluginCall call) {
        if (imageAccess()) { queryRecent(call); return; }
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("notice_inputs", 0);
        if (!Boolean.TRUE.equals(call.getBoolean("request", false)) || prefs.getBoolean("images_asked", false)) {
            finishEmpty(call); return;
        }
        prefs.edit().putBoolean("images_asked", true).apply();
        if (Build.VERSION.SDK_INT >= 34) requestPermissionForAliases(new String[]{"images", "selected"}, call, "imagesResult");
        else requestPermissionForAlias(Build.VERSION.SDK_INT >= 33 ? "images" : "storage", call, "imagesResult");
    }

    @PermissionCallback private void imagesResult(PluginCall call) {
        if (imageAccess()) queryRecent(call); else finishEmpty(call);
    }

    private void finishEmpty(PluginCall call) {
        JSObject result = new JSObject(); result.put("allowed", false); result.put("images", new JSArray()); call.resolve(result);
    }

    private void queryRecent(PluginCall call) {
        worker.execute(() -> {
            JSArray images = new JSArray();
            long cutoff = System.currentTimeMillis() - 5 * 60 * 1000;
            String[] columns = {MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_ADDED,
                MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.BUCKET_DISPLAY_NAME};
            String selection = "(" + MediaStore.Images.Media.DATE_ADDED + " >= ? OR "
                + MediaStore.Images.Media.DATE_TAKEN + " >= ?) AND (LOWER("
                + MediaStore.Images.Media.BUCKET_DISPLAY_NAME + ") LIKE ? OR "
                + MediaStore.Images.Media.BUCKET_DISPLAY_NAME + " LIKE ? OR "
                + MediaStore.Images.Media.BUCKET_DISPLAY_NAME + " LIKE ?)";
            List<JSObject> found = new ArrayList<>();
            try (Cursor cursor = getContext().getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                columns, selection, new String[]{String.valueOf(cutoff / 1000), String.valueOf(cutoff), "%screenshots%", "%截屏%", "%截图%"},
                MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                if (cursor != null) while (cursor.moveToNext()) {
                    long taken = cursor.getLong(2), added = cursor.getLong(1) * 1000;
                    long timestamp = taken > 0 ? taken : added;
                    if (timestamp < cutoff || timestamp > System.currentTimeMillis() + 60000) continue;
                    Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cursor.getLong(0));
                    JSObject item = new JSObject(); item.put("uri", uri.toString()); item.put("timestamp", timestamp);
                    found.add(item);
                }
                found.sort((a, b) -> Long.compare(b.optLong("timestamp"), a.optLong("timestamp")));
                for (JSObject item : found) {
                    if (images.length() >= 8) break;
                    try {
                        item.put("thumbnail", imageData(Uri.parse(item.getString("uri")), 240));
                        readable.add(item.getString("uri")); images.put(item);
                    } catch (Exception ignored) { /* Deleted or revoked items are omitted. */ }
                }
                JSObject result = new JSObject(); result.put("allowed", true); result.put("images", images); call.resolve(result);
            } catch (SecurityException error) { finishEmpty(call); }
            catch (Exception error) { call.reject("读取最近截图失败，请使用选择截图", error); }
        });
    }

    @PluginMethod public void readImage(PluginCall call) {
        String value = call.getString("uri", "");
        if (!readable.contains(value)) { call.reject("图片已失效，请重新选择"); return; }
        worker.execute(() -> {
            try {
                Uri uri = Uri.parse(value);
                JSObject result = new JSObject();
                result.put("dataUrl", Boolean.TRUE.equals(call.getBoolean("original", false)) ? originalImage(uri) : imageData(uri, 1600));
                call.resolve(result);
            } catch (Exception error) { call.reject("无法读取图片，请重新选择", error); }
        });
    }

    private String originalImage(Uri uri) throws Exception {
        String type = getContext().getContentResolver().getType(uri);
        if (type == null || !type.startsWith("image/")) type = "image/jpeg";
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) {
            byte[] buffer = new byte[8192]; int count;
            if (stream == null) throw new Exception("Image unavailable");
            while ((count = stream.read(buffer)) != -1) {
                if (bytes.size() + count > 32 * 1024 * 1024) throw new Exception("图片太大，请先裁剪后选择");
                bytes.write(buffer, 0, count);
            }
        }
        return "data:" + type + ";base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }

    @PluginMethod public void openUrl(PluginCall call) {
        Uri uri = Uri.parse(call.getString("url", ""));
        if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null) {
            call.reject("只能打开 http/https 链接"); return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                call.resolve(new JSObject());
            } catch (Exception error) { call.reject("没有可用的应用打开链接", error); }
        });
    }

    @PluginMethod public void saveQrImage(PluginCall call) {
        if (Build.VERSION.SDK_INT <= 28 && getPermissionState("write") != PermissionState.GRANTED) {
            requestPermissionForAlias("write", call, "savePermissionResult"); return;
        }
        writeQrImage(call);
    }

    @PermissionCallback private void savePermissionResult(PluginCall call) {
        if (getPermissionState("write") == PermissionState.GRANTED) writeQrImage(call);
        else call.reject("未获得保存图片权限，可在系统设置中授权后重试");
    }

    private void writeQrImage(PluginCall call) {
        String data = call.getString("dataUrl", "");
        boolean png = data.startsWith("data:image/png;base64,");
        if (!(png || data.startsWith("data:image/jpeg;base64,")) || data.length() > 16 * 1024 * 1024) {
            call.reject("二维码图片格式无效或图片过大"); return;
        }
        worker.execute(() -> {
            Uri uri = null;
            try {
                byte[] bytes = Base64.decode(data.substring(data.indexOf(',') + 1), Base64.DEFAULT);
                BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                if (bounds.outWidth < 1 || bounds.outHeight < 1) throw new Exception("Invalid image");
                String name = "落笺二维码-" + System.currentTimeMillis() + (png ? ".png" : ".jpg");
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                values.put(MediaStore.Images.Media.MIME_TYPE, png ? "image/png" : "image/jpeg");
                if (Build.VERSION.SDK_INT >= 29) {
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/CampusAction");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                } else {
                    java.io.File directory = new java.io.File(android.os.Environment.getExternalStoragePublicDirectory(
                        android.os.Environment.DIRECTORY_PICTURES), "CampusAction");
                    if (!directory.exists() && !directory.mkdirs()) throw new Exception("Directory unavailable");
                    values.put(MediaStore.Images.Media.DATA, new java.io.File(directory, name).getAbsolutePath());
                }
                uri = getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new Exception("Insert failed");
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new Exception("Write failed"); output.write(bytes);
                }
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues complete = new ContentValues(); complete.put(MediaStore.Images.Media.IS_PENDING, 0);
                    getContext().getContentResolver().update(uri, complete, null, null);
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) {
                if (uri != null) getContext().getContentResolver().delete(uri, null, null);
                call.reject("保存二维码失败，请重试", error);
            }
        });
    }

    private String imageData(Uri uri, int edge) throws Exception {
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(stream, null, options); }
        if (options.outWidth < 1 || options.outHeight < 1) throw new Exception("Invalid image");
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > edge * 2) options.inSampleSize *= 2;
        options.inJustDecodeBounds = false;
        Bitmap bitmap;
        try (InputStream stream = getContext().getContentResolver().openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(stream, null, options); }
        if (bitmap == null) throw new Exception("Invalid image");
        try {
            float scale = Math.min(1f, edge / (float)Math.max(bitmap.getWidth(), bitmap.getHeight()));
            if (scale < 1) {
                Bitmap small = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * scale)),
                    Math.max(1, Math.round(bitmap.getHeight() * scale)), true); bitmap.recycle(); bitmap = small;
            }
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.JPEG, 86, bytes);
            return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } finally { bitmap.recycle(); }
    }

    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
