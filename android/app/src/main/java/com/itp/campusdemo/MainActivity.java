package com.itp.campusdemo;

import android.os.Bundle;
import android.content.res.Configuration;
import android.content.SharedPreferences;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        SharedPreferences themePreferences = getSharedPreferences("campus_theme", MODE_PRIVATE);
        boolean systemDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        String appearanceMode = themePreferences.getString("appearance_mode", "system");
        String legacyLightTheme = themePreferences.getString("palette_theme", "mist");
        String lightTheme = themePreferences.getString("light_theme", legacyLightTheme);
        if ("cyan".equals(lightTheme)) lightTheme = "ice";
        String darkTheme = themePreferences.getString("dark_theme", "graphite");
        boolean useDark = "dark".equals(appearanceMode)
            || ("system".equals(appearanceMode) && systemDark);
        String theme = useDark ? darkTheme : lightTheme;
        if ("graphite".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Graphite);
        } else if ("ice-dark".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_IceDark);
        } else if ("ice".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Ice);
        } else if ("moss".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Moss);
        } else if ("sunny".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Sunny);
        } else if ("mist".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Mist);
        } else {
            setTheme(R.style.AppTheme_NoActionBarLaunch);
        }
        registerPlugin(CalendarIntentPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
