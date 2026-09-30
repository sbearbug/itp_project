package com.itp.campusdemo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CalendarIntentPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
