import AppKit
import Carbon

final class PreferencesWindowController: NSWindowController {
    private var apiKeyTextField: NSSecureTextField!
    private var hotkeyField: NSTextField!
    private var pushToTalkCheckbox: NSButton!
    private var hotkeyRecorder: HotkeyRecorder?

    private static let userDefaultsHotkeyKey = "recordingHotkey"
    private static let userDefaultsPushToTalkKey = "pushToTalkEnabled"

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 300),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "WordsOfWorld — Preferences"
        window.titlebarAppearsTransparent = false
        window.center()
        window.setFrameAutosaveName("PreferencesWindow")
        self.init(window: window)
        setupUI()
        loadSettings()
    }

    private func setupUI() {
        let contentView = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 300))
        window?.contentView = contentView

        let apiKeyLabel = NSTextField(labelWithString: "Groq API Key:")
        apiKeyLabel.frame = NSRect(x: 20, y: 230, width: 100, height: 20)
        contentView.addSubview(apiKeyLabel)

        apiKeyTextField = NSSecureTextField(frame: NSRect(x: 130, y: 228, width: 300, height: 24))
        apiKeyTextField.placeholderString = "Enter your Groq API key"
        contentView.addSubview(apiKeyTextField)

        let hotkeyLabel = NSTextField(labelWithString: "Recording Hotkey:")
        hotkeyLabel.frame = NSRect(x: 20, y: 180, width: 120, height: 20)
        contentView.addSubview(hotkeyLabel)

        hotkeyField = NSTextField(frame: NSRect(x: 150, y: 178, width: 150, height: 24))
        hotkeyField.isEditable = false
        hotkeyField.isSelectable = false
        hotkeyField.alignment = .center
        hotkeyField.stringValue = "Click to record"
        hotkeyField.backgroundColor = .controlBackgroundColor
        contentView.addSubview(hotkeyField)

        let recordButton = NSButton(title: "Record", target: self, action: #selector(startHotkeyRecording))
        recordButton.frame = NSRect(x: 310, y: 176, width: 80, height: 28)
        recordButton.bezelStyle = .rounded
        contentView.addSubview(recordButton)

        let pushToTalkLabel = NSTextField(labelWithString: "Push-to-Talk Mode:")
        pushToTalkLabel.frame = NSRect(x: 20, y: 130, width: 130, height: 20)
        contentView.addSubview(pushToTalkLabel)

        pushToTalkCheckbox = NSButton(checkboxWithTitle: "Hold hotkey to record, release to stop", target: nil, action: nil)
        pushToTalkCheckbox.frame = NSRect(x: 150, y: 128, width: 280, height: 24)
        contentView.addSubview(pushToTalkCheckbox)

        let saveButton = NSButton(title: "Save", target: self, action: #selector(saveSettings))
        saveButton.frame = NSRect(x: 270, y: 20, width: 80, height: 32)
        saveButton.bezelStyle = .rounded
        saveButton.keyEquivalent = "\r"
        contentView.addSubview(saveButton)

        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancel))
        cancelButton.frame = NSRect(x: 360, y: 20, width: 80, height: 32)
        cancelButton.bezelStyle = .rounded
        cancelButton.keyEquivalent = "\u{1b}"
        contentView.addSubview(cancelButton)
    }

    private func loadSettings() {
        if let savedKey = try? KeychainManager.load() {
            apiKeyTextField.stringValue = savedKey
        }

        if let hotkeyData = UserDefaults.standard.data(forKey: Self.userDefaultsHotkeyKey),
           let hotkey = try? JSONDecoder().decode(HotkeyBinding.self, from: hotkeyData) {
            hotkeyField.stringValue = hotkey.displayString
        }

        let pushToTalk = UserDefaults.standard.bool(forKey: Self.userDefaultsPushToTalkKey)
        pushToTalkCheckbox.state = pushToTalk ? .on : .off
    }

    @objc private func startHotkeyRecording() {
        hotkeyField.stringValue = "Press a key..."
        hotkeyField.textColor = .systemBlue
        window?.makeFirstResponder(nil)

        hotkeyRecorder = HotkeyRecorder { [weak self] keyCode, modifiers in
            self?.handleRecordedHotkey(keyCode: keyCode, modifiers: modifiers)
        }
    }

    private func handleRecordedHotkey(keyCode: UInt16, modifiers: NSEvent.ModifierFlags) {
        let encoding: UInt = modifiers.contains(.command) ? 1 : 0
        let shiftEncoding: UInt = modifiers.contains(.shift) ? 1 : 0
        let optionEncoding: UInt = modifiers.contains(.option) ? 1 : 0
        let ctrlEncoding: UInt = modifiers.contains(.control) ? 1 : 0

        let modifierValue: UInt = (ctrlEncoding << 3) | (optionEncoding << 2) | (shiftEncoding << 1) | encoding

        let hotkey = HotkeyBinding(keyCode: keyCode, modifiers: modifierValue)
        hotkeyField.stringValue = hotkey.displayString
        hotkeyField.textColor = .labelColor

        if let data = try? JSONEncoder().encode(hotkey) {
            UserDefaults.standard.set(data, forKey: Self.userDefaultsHotkeyKey)
        }

        hotkeyRecorder = nil
    }

    @objc private func saveSettings() {
        let apiKey = apiKeyTextField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if !apiKey.isEmpty {
            do {
                try KeychainManager.save(apiKey: apiKey)
            } catch {
                showAlert(message: "Failed to save API key: \(error.localizedDescription)")
                return
            }
        }

        UserDefaults.standard.set(pushToTalkCheckbox.state == .on, forKey: Self.userDefaultsPushToTalkKey)

        window?.close()
    }

    @objc private func cancel() {
        window?.close()
    }

    private func showAlert(message: String) {
        let alert = NSAlert()
        alert.messageText = "Error"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}

struct HotkeyBinding: Codable {
    let keyCode: UInt16
    let modifiers: UInt

    init(keyCode: UInt16, modifiers: UInt) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    var displayString: String {
        var parts: [String] = []

        if modifiers & 8 != 0 { parts.append("⌃") }
        if modifiers & 4 != 0 { parts.append("⌥") }
        if modifiers & 2 != 0 { parts.append("⇧") }
        if modifiers & 1 != 0 { parts.append("⌘") }

        let keyName = keyMap[keyCode] ?? "Key\(keyCode)"
        parts.append(keyName)

        return parts.joined()
    }

    private var keyMap: [UInt16: String] = [
        0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X",
        8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R",
        16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6",
        23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
        30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 36: "↵",
        37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",",
        44: "/", 45: "N", 46: "M", 47: ".", 48: "⇥", 49: "Space"
    ]
}

final class HotkeyRecorder {
    private var monitor: Any?
    private let callback: (UInt16, NSEvent.ModifierFlags) -> Void

    init(callback: @escaping (UInt16, NSEvent.ModifierFlags) -> Void) {
        self.callback = callback
        self.monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handleKeyEvent(event)
            return nil
        }
    }

    deinit {
        if let monitor = monitor {
            NSEvent.removeMonitor(monitor)
        }
    }

    private func handleKeyEvent(_ event: NSEvent) {
        callback(event.keyCode, event.modifierFlags)
    }
}