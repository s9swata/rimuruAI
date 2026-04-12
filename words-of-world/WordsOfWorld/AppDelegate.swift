import AppKit
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var menuBar: MenuBarController!
    private var preferences: PreferencesWindowController?
    private var isRecording = false
    private var recordingURL: URL?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBar()
        setupHotkey()
        checkAPIPermissions()
    }

    func applicationWillTerminate(_ notification: Notification) {
        HotkeyManager.shared.unregister()
    }

    private func setupMenuBar() {
        menuBar = MenuBarController()

        menuBar.onStartRecording = { [weak self] in
            self?.toggleRecording()
        }

        menuBar.onOpenPreferences = { [weak self] in
            self?.showPreferences()
        }

        menuBar.onQuit = {
            NSApplication.shared.terminate(nil)
        }
    }

    private func setupHotkey() {
        let manager = HotkeyManager.shared

        manager.onHotkeyEvent = { [weak self] event in
            switch event {
            case .pressed:
                self?.toggleRecording()
            case .released:
                if manager.mode == .pushToTalk {
                    self?.stopRecording()
                }
            }
        }

        manager.register()
    }

    private func checkAPIPermissions() {
        Task {
            let micGranted = await RecorderManager.requestPermission()
            if !micGranted {
                showNotification(
                    title: "Microphone Access Required",
                    body: "Please enable microphone access in System Preferences > Security & Privacy > Privacy > Microphone"
                )
            }

            await MainActor.run {
                PasteInjector.shared.requestAccessibilityPermission()
            }
        }
    }

    private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        guard !isRecording else { return }

        Task {
            do {
                let url = try await RecorderManager.startRecording()
                recordingURL = url
                isRecording = true

                await MainActor.run {
                    menuBar.setState(.recording)
                }
            } catch let error as RecorderError {
                await MainActor.run {
                    showError(error)
                    menuBar.setState(.idle)
                }
            } catch {
                await MainActor.run {
                    showError(error)
                    menuBar.setState(.idle)
                }
            }
        }
    }

    private func stopRecording() {
        guard isRecording, let url = RecorderManager.stopRecording() else { return }

        isRecording = false
        recordingURL = url

        menuBar.setState(.processing)

        processRecording(url: url)
    }

    private func processRecording(url: URL) {
        Task {
            do {
                // Check for significant audio (voice activity detection)
                if !RecorderManager.hasSignificantAudio() {
                    NSLog("[WordsOfWorld] Silent audio detected, skipping transcription")
                    try? FileManager.default.removeItem(at: url)
                    await MainActor.run {
                        menuBar.setState(.idle)
                    }
                    return
                }
                
                let audioData = try Data(contentsOf: url)

                let transcript = try await GroqTranscriber.transcribe(audioData: audioData, fileName: url.lastPathComponent)

                let cleanedText = TextProcessor.process(transcript)

                try await MainActor.run {
                    try PasteInjector.shared.inject(transcript: cleanedText)
                }

                try? FileManager.default.removeItem(at: url)

                await MainActor.run {
                    menuBar.setState(.idle)
                    showNotification(title: "Transcription Complete", body: cleanedText)
                }
            } catch {
                await MainActor.run {
                    showError(error)
                    menuBar.setState(.idle)
                }
            }
        }
    }

    private func showPreferences() {
        if preferences == nil {
            preferences = PreferencesWindowController()
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(preferencesWindowWillClose),
                name: NSWindow.willCloseNotification,
                object: preferences?.window
            )
        }
        NSApp.setActivationPolicy(.regular)
        preferences?.showWindow(nil)
        preferences?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func preferencesWindowWillClose() {
        NotificationCenter.default.removeObserver(
            self,
            name: NSWindow.willCloseNotification,
            object: preferences?.window
        )
        preferences = nil
        NSApp.setActivationPolicy(.accessory)
    }

    private func showError(_ error: Error) {
        NSLog("[WordsOfWorld] Error: \(error.localizedDescription)")

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = errorTitle(for: error)
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "OK")

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        if preferences == nil {
            NSApp.setActivationPolicy(.accessory)
        }
    }

    private func errorTitle(for error: Error) -> String {
        if let e = error as? RecorderError, case .permissionDenied = e {
            return "Microphone Permission Denied"
        }
        if let e = error as? PasteInjectorError, case .accessibilityPermissionDenied = e {
            return "Accessibility Permission Required"
        }
        return "Error"
    }

    private func showNotification(title: String, body: String) {
        // UNUserNotificationCenter requires a proper .app bundle; fall back to NSLog for
        // SPM-built executables where bundleURL points to the build directory, not an .app.
        guard Bundle.main.bundleURL.pathExtension == "app" else {
            NSLog("[WordsOfWorld] \(title): \(body)")
            return
        }

        let center = UNUserNotificationCenter.current()

        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }

            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default

            let request = UNNotificationRequest(
                identifier: UUID().uuidString,
                content: content,
                trigger: nil
            )

            center.add(request, withCompletionHandler: nil)
        }
    }
}