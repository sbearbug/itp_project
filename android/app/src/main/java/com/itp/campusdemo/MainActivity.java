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
        boolean useDark = "dark".equals(appearanceMode)
            || ("system".equals(appearanceMode) && systemDark);
        String selectedTheme = themePreferences.getString("selected_theme", null);
        if (selectedTheme == null) {
            if (useDark) {
                String legacyDarkTheme = themePreferences.getString("dark_theme", "graphite");
                selectedTheme = "ice-dark".equals(legacyDarkTheme) ? "ice" : "mist";
            } else {
                String legacyLightTheme = themePreferences.getString(
                    "light_theme",
                    themePreferences.getString("palette_theme", "mist")
                );
                selectedTheme = "cyan".equals(legacyLightTheme) ? "ice" : legacyLightTheme;
            }
        }
        if (!"mist".equals(selectedTheme) && !"ice".equals(selectedTheme)
            && !"moss".equals(selectedTheme) && !"sunny".equals(selectedTheme)) {
            selectedTheme = "mist";
        }
        String theme = selectedTheme + (useDark ? "-dark" : "-light");
        if ("mist-dark".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Graphite);
        } else if ("ice-dark".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_IceDark);
        } else if ("moss-dark".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_MossDark);
        } else if ("sunny-dark".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_SunnyDark);
        } else if ("ice-light".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Ice);
        } else if ("moss-light".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Moss);
        } else if ("sunny-light".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Sunny);
        } else if ("mist-light".equals(theme)) {
            setTheme(R.style.AppTheme_NoActionBarLaunch_Mist);
        } else {
            setTheme(R.style.AppTheme_NoActionBarLaunch);
        }
        registerPlugin(CalendarIntentPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
