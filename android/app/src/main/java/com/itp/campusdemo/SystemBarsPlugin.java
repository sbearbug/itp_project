package com.itp.campusdemo;

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
        String theme = call.getString("theme", "mist");
        String mode = call.getString("mode", "system");
        String lightTheme = call.getString("lightTheme", "mist");
        String darkTheme = call.getString("darkTheme", "graphite");
        getActivity().runOnUiThread(() -> {
            try {
                Window window = getActivity().getWindow();
                window.setNavigationBarColor(Color.parseColor(colorValue));
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                controller.setAppearanceLightNavigationBars(darkIcons);
                getActivity().getSharedPreferences("campus_theme", 0)
                    .edit()
                    .putString("resolved_theme", theme)
                    .putString("appearance_mode", mode)
                    .putString("light_theme", lightTheme)
                    .putString("dark_theme", darkTheme)
                    .apply();
                call.resolve(new JSObject());
            } catch (Exception error) {
                call.reject("无法更新系统导航栏", error);
            }
        });
    }
}
