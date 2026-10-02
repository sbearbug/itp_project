package com.itp.notice;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {
    @PluginMethod
    public void setNavigationBar(PluginCall call) {
        String colorValue = call.getString("color", "#F4F4F6");
        boolean darkIcons = Boolean.TRUE.equals(call.getBoolean("darkIcons", true));
        String theme = call.getString("theme", "mist-light");
        String mode = call.getString("mode", "system");
        String selectedTheme = call.getString("selectedTheme", "mist");
        getActivity().runOnUiThread(() -> {
            try {
                Window window = getActivity().getWindow();
                window.setNavigationBarColor(Color.parseColor(colorValue));
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                // darkIcons 表示“用深色图标”（浅色背景）。状态栏与导航栏用同一极性：
                // 浅色主题 -> 深色图标，深色主题 -> 浅色图标。
                controller.setAppearanceLightNavigationBars(darkIcons);
                // Android 15+ 上 StatusBar 插件的 setStyle 可能不生效，这里兜一次底，
                // 否则深色主题下状态栏图标会和背景同色而看不见。
                controller.setAppearanceLightStatusBars(darkIcons);
                getActivity().getSharedPreferences("campus_theme", 0)
                    .edit()
                    .putString("resolved_theme", theme)
                    .putString("appearance_mode", mode)
                    .putString("selected_theme", selectedTheme)
                    .apply();
                call.resolve(new JSObject());
            } catch (Exception error) {
                call.reject("无法更新系统导航栏", error);
            }
        });
    }
}
