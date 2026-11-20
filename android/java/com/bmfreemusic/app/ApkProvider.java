package com.bmfreemusic.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * 极简 ContentProvider，只为了给安装器递一个 content:// 的 APK 流。
 *
 * targetSdk 34 下 file:// 会被 FileUriExposedException 直接拒绝，
 * 而引 AndroidX 的 FileProvider 只为这一件事太重，索性自己写。
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.bmfreemusic.app.apk";
    public static final Uri CONTENT_URI = Uri.parse("content://" + AUTHORITY + "/update.apk");

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = new File(getContext().getCacheDir(), "update.apk");
        if (!f.exists()) throw new FileNotFoundException("update.apk not found");
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
