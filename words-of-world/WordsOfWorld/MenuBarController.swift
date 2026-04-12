import AppKit

enum RecordingState {
    case idle
    case recording
    case processing
}

final class MenuBarController {
    private var statusItem: NSStatusItem?
    private var menu: NSMenu?
    private var recordingMenuItem: NSMenuItem?
    private var currentState: RecordingState = .idle

    var onStartRecording: (() -> Void)?
    var onOpenPreferences: (() -> Void)?
    var onQuit: (() -> Void)?

    init() {
        setupStatusItem()
        setupMenu()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateIcon(for: .idle)
    }

    private func setupMenu() {
        menu = NSMenu()

        recordingMenuItem = NSMenuItem(title: "Start Recording", action: #selector(startRecordingClicked), keyEquivalent: "r")
        recordingMenuItem?.target = self
        menu?.addItem(recordingMenuItem!)

        menu?.addItem(NSMenuItem.separator())

        let preferencesItem = NSMenuItem(title: "Preferences", action: #selector(preferencesClicked), keyEquivalent: ",")
        preferencesItem.target = self
        menu?.addItem(preferencesItem)

        menu?.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit", action: #selector(quitClicked), keyEquivalent: "q")
        quitItem.target = self
        menu?.addItem(quitItem)

        statusItem?.menu = menu
    }

    private func updateIcon(for state: RecordingState) {
        guard let button = statusItem?.button else { return }
        button.contentTintColor = nil

        switch state {
        case .idle:
            if let image = NSImage(systemSymbolName: "mic", accessibilityDescription: "Idle") {
                image.isTemplate = true
                button.image = image
            }
        case .recording:
            let config = NSImage.SymbolConfiguration(paletteColors: [.systemRed])
            button.image = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: "Recording")?
                .withSymbolConfiguration(config)
        case .processing:
            let config = NSImage.SymbolConfiguration(paletteColors: [.systemBlue])
            button.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Processing")?
                .withSymbolConfiguration(config)
        }
    }

    func setState(_ state: RecordingState) {
        currentState = state
        updateIcon(for: state)

        switch state {
        case .idle:
            recordingMenuItem?.title = "Start Recording"
            recordingMenuItem?.isEnabled = true
        case .recording:
            recordingMenuItem?.title = "Stop Recording"
            recordingMenuItem?.isEnabled = true
        case .processing:
            recordingMenuItem?.title = "Processing..."
            recordingMenuItem?.isEnabled = false
        }
    }

    @objc private func startRecordingClicked() {
        onStartRecording?()
    }

    @objc private func preferencesClicked() {
        onOpenPreferences?()
    }

    @objc private func quitClicked() {
        onQuit?()
    }
}