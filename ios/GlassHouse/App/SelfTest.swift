import WebKit

/// Debug builds only: launched with `-selftest`, the app checks that each bundled page loads and
/// that WebKit gives it what the instruments need (secure context, AudioWorklet, Worker, the physics),
/// prints one `SELFTEST {json}` line per page, then moves to the next page. Used by CI in the simulator.
enum SelfTest {
    #if DEBUG
    static let enabled = ProcessInfo.processInfo.arguments.contains("-selftest")
    static let pages = ["index.html", "bowl.html", "harp.html"]
    static var startPage: String? { enabled ? pages[0] : nil }
    private static var index = 0

    static func run(in w: WKWebView) {
        guard enabled else { return }
        let script = """
        const r = { page: location.pathname, secure: window.isSecureContext, worklet: typeof AudioWorkletNode !== 'undefined',
                    worker: typeof Worker !== 'undefined', physics: !!window.GlassPhysics };
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          r.sampleRate = ctx.sampleRate;
          const url = URL.createObjectURL(new Blob(["registerProcessor('t', class extends AudioWorkletProcessor { process() { return true; } })"], { type: 'application/javascript' }));
          await ctx.audioWorklet.addModule(url);
          new AudioWorkletNode(ctx, 't');
          r.workletModule = true;
        } catch (e) { r.workletModule = String(e); }
        await new Promise(res => setTimeout(res, 3500));
        const gh = window.__glasshouse, hp = window.__harp;
        if (gh) { r.modes = gh.wet ? gh.wet.modes.length : 0; r.table = !!gh.table; r.f0 = gh.wet && gh.wet.modes[0] && Math.round(gh.wet.modes[0].f); }
        if (hp) { r.glasses = hp.glasses.length; r.tuned = hp.glasses.filter(g => isFinite(g.f)).length; r.physics = r.tuned > 0; }
        if (gh) r.physics = r.physics && r.modes > 0;
        return JSON.stringify(r);
        """
        w.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let v): print("SELFTEST \(v ?? "null")"); fflush(stdout)
            case .failure(let e): print("SELFTEST {\"page\":\"\(pages[index])\",\"error\":\"\(e.localizedDescription)\"}"); fflush(stdout)
            }
            index += 1
            if index < pages.count {
                w.load(URLRequest(url: URL(string: "\(InstrumentController.scheme)://app/\(pages[index])")!))
            } else {
                print("SELFTEST DONE"); fflush(stdout)
            }
        }
    }
    #else
    static var startPage: String? { nil }
    static func run(in w: WKWebView) {}
    #endif
}
