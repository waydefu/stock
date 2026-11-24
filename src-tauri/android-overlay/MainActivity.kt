package io.github.waydefu.cryptolab

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

// Android-only immersive shell. No JS bridge, trading permission or plugin.
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val content = findViewById<View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            // Reserve stable system-bar and cutout space, including while bars
            // are transiently revealed. Never hard-code device pixel values.
            val safe = insets.getInsetsIgnoringVisibility(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val gestures = insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures())
            view.setPadding(
                maxOf(safe.left, gestures.left),
                maxOf(safe.top, gestures.top),
                maxOf(safe.right, gestures.right),
                maxOf(safe.bottom, gestures.bottom)
            )
            // The native root owns system-bar/cutout spacing. Preserve IME
            // and other insets for WebView without applying the same area twice.
            WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(), androidx.core.graphics.Insets.NONE)
                .setInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(), androidx.core.graphics.Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.mandatorySystemGestures(), androidx.core.graphics.Insets.NONE)
                .build()
        }
        ViewCompat.requestApplyInsets(content)
        enterImmersive()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersive()
    }

    private fun enterImmersive() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }
}
