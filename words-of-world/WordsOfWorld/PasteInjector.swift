import AppKit
import ApplicationServices

enum PasteInjectorError: LocalizedError {
    case accessibilityPermissionDenied
    case clipboardSaveFailed
    case pasteboardWriteFailed
    case keyEventFailed

    var errorDescription: String? {
        switch self {
        case .accessibilityPermissionDenied:
            return "Accessibility permission is required to paste text"
        case .clipboardSaveFailed:
            return "Failed to save current clipboard contents"
        case .pasteboardWriteFailed:
            return "Failed to write transcript to pasteboard"
        case .keyEventFailed:
            return "Failed to simulate paste keyboard event"
        }
    }
}

final class PasteInjector {
    static let shared = PasteInjector()

    private let pasteboard = NSPasteboard.general
    private var originalContents: [NSPasteboard.PasteboardType: Data]?
    private var restorationTimer: Timer?
    private var highlightPanel: FocusHighlightPanel?

    private init() {}

    func checkAccessibilityPermission() -> Bool {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        return AXIsProcessTrustedWithOptions(options as CFDictionary)
    }

    func requestAccessibilityPermission() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        _ = AXIsProcessTrustedWithOptions(options as CFDictionary)
    }

    func inject(transcript: String) throws {
        guard checkAccessibilityPermission() else {
            throw PasteInjectorError.accessibilityPermissionDenied
        }

        saveCurrentClipboard()
        try writeToPasteboard(text: transcript)
        showFocusHighlight()
        try simulatePaste()
        scheduleClipboardRestoration()
    }

    private func saveCurrentClipboard() {
        originalContents = [:]

        for item in pasteboard.pasteboardItems ?? [] {
            for type in item.types {
                if let data = item.data(forType: type) {
                    originalContents?[type] = data
                }
            }
        }
    }

    private func writeToPasteboard(text: String) throws {
        pasteboard.clearContents()
        let success = pasteboard.setString(text, forType: .string)
        guard success else {
            throw PasteInjectorError.pasteboardWriteFailed
        }
    }

    private func simulatePaste() throws {
        let source = CGEventSource(stateID: .hidSystemState)

        guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: true) else {
            throw PasteInjectorError.keyEventFailed
        }
        guard let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: false) else {
            throw PasteInjectorError.keyEventFailed
        }

        keyDown.flags = .maskCommand
        keyUp.flags = .maskCommand

        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }

    private func scheduleClipboardRestoration() {
        restorationTimer?.invalidate()
        restorationTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: false) { [weak self] _ in
            self?.restoreOriginalClipboard()
        }
    }

    private func restoreOriginalClipboard() {
        guard let contents = originalContents else { return }

        pasteboard.clearContents()

        for (type, data) in contents {
            let item = NSPasteboardItem()
            item.setData(data, forType: type)
            pasteboard.writeObjects([item])
        }

        originalContents = nil
    }

    private func showFocusHighlight() {
        guard let frontApp = NSWorkspace.shared.frontmostApplication else { return }

        let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)
        var focusedRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success,
              let focusedElement = focusedRef else { return }

        var frameRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(focusedElement as! AXUIElement, "AXFrame" as CFString, &frameRef) == .success,
              let frameValue = frameRef else { return }

        var axFrame = CGRect.zero
        guard AXValueGetValue(frameValue as! AXValue, .cgRect, &axFrame) else { return }

        // AX reports top-left origin; NSWindow uses bottom-left — flip on main screen
        guard let screen = NSScreen.main else { return }
        let flippedY = screen.frame.height - axFrame.origin.y - axFrame.height
        let windowFrame = CGRect(x: axFrame.origin.x, y: flippedY,
                                 width: axFrame.width, height: axFrame.height)

        highlightPanel?.close()
        highlightPanel = FocusHighlightPanel(elementFrame: windowFrame)
        highlightPanel?.orderFront(nil)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) { [weak self] in
            self?.highlightPanel?.close()
            self?.highlightPanel = nil
        }
    }
}

// MARK: - Focus highlight overlay

final class FocusHighlightPanel: NSPanel {
    init(elementFrame: CGRect) {
        let inset: CGFloat = -3
        super.init(
            contentRect: elementFrame.insetBy(dx: inset, dy: inset),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        level = .floating
        ignoresMouseEvents = true
        contentView = HighlightBorderView(frame: NSRect(origin: .zero, size: self.frame.size))
    }
}

private final class HighlightBorderView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemBlue.withAlphaComponent(0.85).setStroke()
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 1.5, dy: 1.5), xRadius: 5, yRadius: 5)
        path.lineWidth = 2.5
        path.stroke()
    }
}