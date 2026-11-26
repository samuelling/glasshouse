import CoreMIDI
import Foundation

/// Listens to every MIDI source the system knows about (USB keyboards, Bluetooth MIDI,
/// network sessions and other apps' virtual outputs) and passes channel messages to the page.
final class MIDIBridge {
    var onMessage: ((UInt8, UInt8, UInt8) -> Void)?
    var onDevices: (([String]) -> Void)?
    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var started = false
    private var connected = Set<MIDIEndpointRef>()

    func start() {
        if started { announce(); return }
        started = true
        MIDIClientCreateWithBlock("GlassHouse" as CFString, &client) { [weak self] note in
            if note.pointee.messageID == .msgSetupChanged {
                DispatchQueue.main.async { self?.connectAll() }
            }
        }
        MIDIInputPortCreateWithProtocol(client, "GlassHouse In" as CFString, ._1_0, &port) { [weak self] list, _ in
            self?.receive(list)
        }
        connectAll()
    }

    private func connectAll() {
        for i in 0..<MIDIGetNumberOfSources() {
            let src = MIDIGetSource(i)
            if src != 0, !connected.contains(src), MIDIPortConnectSource(port, src, nil) == noErr { connected.insert(src) }
        }
        announce()
    }

    func announce() {
        var names: [String] = []
        for i in 0..<MIDIGetNumberOfSources() {
            var name: Unmanaged<CFString>?
            if MIDIObjectGetStringProperty(MIDIGetSource(i), kMIDIPropertyDisplayName, &name) == noErr, let n = name {
                names.append(n.takeRetainedValue() as String)
            }
        }
        onDevices?(names)
    }

    /// Universal MIDI Packets, MIDI 1.0 protocol: message type 0x2 words are channel voice messages
    /// laid out as 0x2g ss d1 d2.
    private func receive(_ list: UnsafePointer<MIDIEventList>) {
        var out: [(UInt8, UInt8, UInt8)] = []
        for packet in list.unsafeSequence() {
            let count = Int(packet.pointee.wordCount)
            withUnsafeBytes(of: packet.pointee.words) { raw in
                let words = raw.bindMemory(to: UInt32.self)
                var i = 0
                while i < min(count, words.count) {
                    let w = words[i], type = w >> 28
                    if type == 0x2 {
                        let status = UInt8((w >> 16) & 0xFF), d1 = UInt8((w >> 8) & 0x7F), d2 = UInt8(w & 0x7F)
                        let kind = status & 0xF0
                        if kind == 0x80 || kind == 0x90 || kind == 0xB0 { out.append((status, d1, d2)) }
                    }
                    i += [1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4][Int(type)]
                }
            }
        }
        guard !out.isEmpty else { return }
        DispatchQueue.main.async { for m in out { self.onMessage?(m.0, m.1, m.2) } }
    }
}
