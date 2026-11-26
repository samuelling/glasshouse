import SwiftUI
import AVFoundation

/// GlassHouse: physically modelled singing glass, singing bowl and glass harp.
/// The instruments themselves (shell finite elements, potential-flow water, stick–slip friction,
/// the audio engine and the visuals) are the bundled pages in Web/, run entirely on the device.
/// This shell adds what a browser can't: Core MIDI (USB, Bluetooth, network and other apps),
/// playing through the silent switch, haptics, and a screen that stays awake while you play.
@main
struct GlassHouseApp: App {
    init() { AudioSession.configure() }
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @Environment(\.scenePhase) private var phase
    var body: some View {
        InstrumentView()
            .ignoresSafeArea()
            .background(Color.black)
            .statusBarHidden(true)
            .persistentSystemOverlays(.hidden)
            .onChange(of: phase) { _, p in
                UIApplication.shared.isIdleTimerDisabled = (p == .active)
                if p == .active { AudioSession.configure() }
            }
    }
}

enum AudioSession {
    /// An instrument should sound with the ring/silent switch off, like GarageBand.
    static func configure() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default, options: [])
        try? s.setPreferredIOBufferDuration(0.005)
        try? s.setActive(true)
    }
}
