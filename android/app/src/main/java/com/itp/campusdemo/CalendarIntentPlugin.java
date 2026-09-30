package com.itp.campusdemo;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.CalendarContract;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CalendarIntent")
public class CalendarIntentPlugin extends Plugin {
    @PluginMethod
    public void insert(PluginCall call) {
        String title = call.getString("title", "校园活动");
        Long beginMs = call.getLong("beginMs");
        Long endMs = call.getLong("endMs");

        if (beginMs == null || endMs == null) {
            call.reject("缺少活动时间");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, beginMs)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, call.getBoolean("allDay", false))
            .putExtra(CalendarContract.Events.EVENT_LOCATION, call.getString("location", ""))
            .putExtra(CalendarContract.Events.DESCRIPTION, call.getString("description", ""));

        try {
            getActivity().startActivity(intent);
            call.resolve(new JSObject().put("launched", true));
        } catch (ActivityNotFoundException error) {
            call.reject("设备上没有可用的日历应用", error);
        }
    }
}
