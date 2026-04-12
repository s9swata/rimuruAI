import AppKit
import Carbon

enum HotkeyMode: Int {
    case toggle = 0
    case pushToTalk = 1
}

enum HotkeyEvent {
    case pressed
    case released
}

final class HotkeyManager {
    static let shared = HotkeyManager()

    private var hotkeyRef: EventHotKeyRef?
    private var eventHandler: EventHandlerRef?
    private var isRecording = false

    var onHotkeyEvent: ((HotkeyEvent) -> Void)?

    var mode: HotkeyMode {
        get {
            let rawValue = UserDefaults.standard.integer(forKey: "hotkeyMode")
            return HotkeyMode(rawValue: rawValue) ?? .toggle
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: "hotkeyMode")
        }
    }

    private init() {}

    func register() {
        let modifier: UInt32 = UInt32(optionKey)
        let keyCode: UInt32 = 49 // Space key

        var pressedEventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))

        let handlerBlock: EventHandlerUPP = { _, event, userData -> OSStatus in
            guard let userData = userData else { return OSStatus(eventNotHandledErr) }
            let manager = Unmanaged<HotkeyManager>.fromOpaque(userData).takeUnretainedValue()
            manager.handleHotkey()
            return noErr
        }

        let selfPointer = Unmanaged.passUnretained(self).toOpaque()
        var handlerRef: EventHandlerRef?
        let installStatus = InstallEventHandler(GetApplicationEventTarget(), handlerBlock, 1, &pressedEventType, selfPointer, &handlerRef)
        if installStatus == noErr {
            eventHandler = handlerRef
        }

        let hotkeyID = EventHotKeyID(signature: OSType(0x574F5753), id: 1) // "WOWS"
        let status = RegisterEventHotKey(keyCode, modifier, hotkeyID, GetApplicationEventTarget(), 0, &hotkeyRef)

        if status != noErr {
            print("Failed to register hotkey: \(status)")
        }
        
        NSEvent.addLocalMonitorForEvents(matching: .keyUp) { [weak self] event in
            if event.keyCode == 49 && event.modifierFlags.contains(.option) {
                self?.handleRelease()
            }
            return event
        }

        NSEvent.addGlobalMonitorForEvents(matching: .keyUp) { [weak self] event in
            if event.keyCode == 49 && event.modifierFlags.contains(.option) {
                self?.handleRelease()
            }
        }
    }

    func unregister() {
        if let hotkeyRef = hotkeyRef {
            UnregisterEventHotKey(hotkeyRef)
            self.hotkeyRef = nil
        }
        if let eventHandler = eventHandler {
            RemoveEventHandler(eventHandler)
            self.eventHandler = nil
        }
    }

    private func handleHotkey() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            switch self.mode {
            case .toggle:
                // Always fire .pressed in toggle mode; AppDelegate.toggleRecording() owns start/stop logic
                self.onHotkeyEvent?(.pressed)

            case .pushToTalk:
                self.isRecording = true
                self.onHotkeyEvent?(.pressed)
            }
        }
    }

    func handleRelease() {
        guard mode == .pushToTalk, isRecording else { return }
        isRecording = false
        onHotkeyEvent?(.released)
    }
}