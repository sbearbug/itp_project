package com.itp.campusdemo;

import android.os.Bundle;
import android.content.SharedPreferences;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 启动页背景默认由 manifest 的 AppTheme.NoActionBarLaunch 决定，
        // 其中 @color/splash_background 会在 values-night 下自动变为深色。
        // 只有用户在应用内明确选择浅色或深色时，才用固定背景覆盖系统深浅。
        SharedPreferences themePreferences = getSharedPreferences("campus_theme", MODE_PRIVATE);
        String appearanceMode = themePreferences.getString("appearance_mode", "system");
        if ("light".equals(appearanceMode)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Light);
        } else if ("dark".equals(appearanceMode)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Dark);
        }
        registerPlugin(CalendarIntentPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
