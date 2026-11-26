import SwiftUI
import WebKit
import CoreAudioKit
import UniformTypeIdentifiers

struct InstrumentView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> InstrumentController { InstrumentController() }
    func updateUIViewController(_ vc: InstrumentController, context: Context) {}
}

/// Hosts the bundled instrument pages and bridges them to the device.
final class InstrumentController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let scheme = "glasshouse"
    private var web: WKWebView!
    private let midi = MIDIBridge()
    private let selection = UISelectionFeedbackGenerator()
    private let impact = UIImpactFeedbackGenerator(style: .soft)

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: Self.scheme)
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.allowsInlineMediaPlayback = true
        cfg.userContentController.add(WeakMessageHandler(self), name: "gh")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        web.navigationDelegate = self
        web.uiDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        view = web

        midi.onMessage = { [weak self] s, d1, d2 in
            self?.js("window.GHNative && GHNative.midi && GHNative.midi(\(s),\(d1),\(d2))")
        }
        midi.onDevices = { [weak self] names in
            let data = (try? JSONSerialization.data(withJSONObject: names)) ?? Data("[]".utf8)
            self?.js("window.GHNative && GHNative.devices && GHNative.devices(\(String(decoding: data, as: UTF8.self)))")
        }
        selection.prepare()
        web.load(URLRequest(url: URL(string: "\(Self.scheme)://app/\(SelfTest.startPage ?? "index.html")")!))
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }

    private func js(_ source: String) {
        DispatchQueue.main.async { self.web.evaluateJavaScript(source, completionHandler: nil) }
    }

    // Messages from the page: window.webkit.messageHandlers.gh.postMessage({cmd: ...})
    func handle(_ body: Any) {
        guard let b = body as? [String: Any], let cmd = b["cmd"] as? String else { return }
        switch cmd {
        case "ready": midi.start()                 // each page asks once it has its MIDI handler
        case "tick": selection.selectionChanged(); selection.prepare()
        case "tap": impact.impactOccurred(intensity: CGFloat((b["v"] as? Double) ?? 0.6))
        case "btmidi": presentBluetoothMIDI()
        default: break
        }
    }

    private func presentBluetoothMIDI() {
        let bt = CABTMIDICentralViewController()
        let nav = UINavigationController(rootViewController: bt)
        bt.navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak nav] _ in
            nav?.dismiss(animated: true)
        })
        nav.overrideUserInterfaceStyle = .dark
        nav.modalPresentationStyle = .formSheet
        present(nav, animated: true)
    }

    // Keep the instrument pages in the app; anything on the web opens in Safari.
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, let s = u.scheme, s == "http" || s == "https" || s == "mailto" {
            UIApplication.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        w.scrollView.pinchGestureRecognizer?.isEnabled = false
        SelfTest.run(in: w)
    }

    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }

    // window.open from a page: load it in place
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { w.load(URLRequest(url: u)) }
        return nil
    }
}

/// Avoids the retain cycle WKUserContentController would otherwise create.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: InstrumentController?
    init(_ t: InstrumentController) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.handle(m.body) }
}

/// Serves the bundled pages at glasshouse://app/<file>, so they get a proper origin
/// (needed for the AudioWorklet and the physics Web Worker) and work fully offline.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ w: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var name = (url.path as NSString).lastPathComponent
        if name.isEmpty || name == "/" { name = "index.html" }
        guard let file = Bundle.main.url(forResource: name, withExtension: nil), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let type = mime.hasPrefix("text/") || mime.contains("javascript") ? mime + "; charset=utf-8" : mime
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-cache"])!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ w: WKWebView, stop task: WKURLSchemeTask) {}
}
