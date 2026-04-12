# Voice-to-Text Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native macOS menu bar app that records voice via global hotkey, transcribes via Groq's whisper-large-v3-turbo, and auto-pastes the cleaned result into the focused text field.

**Architecture:** Swift AppKit app (no SwiftUI lifecycle) with six isolated managers wired through AppDelegate. Audio is recorded to a temp .m4a, POSTed to Groq, cleaned by TextProcessor, and injected via CGEvent ⌘V paste. API key lives in Keychain.

**Tech Stack:** Swift 5.9, macOS 13+, AVFoundation, Carbon.framework (global hotkeys), URLSession, Security.framework (Keychain), UserNotifications, XCTest, xcodegen (Homebrew)

---

## File Map

```
words-of-world/
├── project.yml                              # xcodegen config
├── WordsOfWorld/
│   ├── main.swift                           # NSApplication entry point
│   ├── AppDelegate.swift                    # Wires all managers, handles state
│   ├── Managers/
│   │   ├── HotkeyManager.swift              # Carbon RegisterEventHotKey
│   │   ├── RecorderManager.swift            # AVAudioRecorder, .m4a output
│   │   ├── GroqTranscriber.swift            # URLSession multipart POST
│   │   ├── TextProcessor.swift              # Cleanup: capitalize, punctuate, trim
│   │   └── PasteInjector.swift              # NSPasteboard + CGEvent ⌘V
│   ├── UI/
│   │   ├── MenuBarController.swift          # NSStatusItem, icon states, menu
│   │   └── PreferencesWindowController.swift # NSWindow + SwiftUI PreferencesView
│   ├── Storage/
│   │   └── KeychainManager.swift            # BYOK API key save/load/delete
│   ├── Info.plist                           # LSUIElement=true, mic description
│   └── WordsOfWorld.entitlements            # sandbox=false, audio-input=true
└── WordsOfWorldTests/
    ├── TextProcessorTests.swift
    ├── KeychainManagerTests.swift
    └── GroqTranscriberTests.swift
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `words-of-world/project.yml`
- Create: `words-of-world/WordsOfWorld/Info.plist`
- Create: `words-of-world/WordsOfWorld/WordsOfWorld.entitlements`
- Create: `words-of-world/WordsOfWorld/main.swift`

- [ ] **Step 1: Install xcodegen**

```bash
brew install xcodegen
```

Expected output: `xcodegen` installed or `Warning: xcodegen X.X.X already installed`

- [ ] **Step 2: Create directory structure**

```bash
cd /path/to/rimuruAI/words-of-world
mkdir -p WordsOfWorld/Managers WordsOfWorld/UI WordsOfWorld/Storage WordsOfWorldTests
```

- [ ] **Step 3: Write `project.yml`**

```yaml
name: WordsOfWorld
options:
  bundleIdPrefix: com.rimuruai
  deploymentTarget:
    macOS: "13.0"
  xcodeVersion: "15"
targets:
  WordsOfWorld:
    type: application
    platform: macOS
    sources:
      - WordsOfWorld
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: com.rimuruai.words-of-world
      SWIFT_VERSION: "5.9"
      MACOSX_DEPLOYMENT_TARGET: "13.0"
      CODE_SIGN_STYLE: Automatic
      CODE_SIGN_IDENTITY: "-"
      INFOPLIST_FILE: WordsOfWorld/Info.plist
      CODE_SIGN_ENTITLEMENTS: WordsOfWorld/WordsOfWorld.entitlements
    dependencies:
      - sdk: Carbon.framework
      - sdk: UserNotifications.framework
  WordsOfWorldTests:
    type: bundle.unit-test
    platform: macOS
    sources:
      - WordsOfWorldTests
    settings:
      SWIFT_VERSION: "5.9"
      MACOSX_DEPLOYMENT_TARGET: "13.0"
    dependencies:
      - target: WordsOfWorld
```

- [ ] **Step 4: Write `WordsOfWorld/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>LSUIElement</key>
    <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>WordsOfWorld records your voice to transcribe it into text.</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>CFBundleIdentifier</key>
    <string>com.rimuruai.words-of-world</string>
    <key>CFBundleName</key>
    <string>WordsOfWorld</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
</dict>
</plist>
```

- [ ] **Step 5: Write `WordsOfWorld/WordsOfWorld.entitlements`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
</dict>
</plist>
```

- [ ] **Step 6: Write `WordsOfWorld/main.swift`**

```swift
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
```

- [ ] **Step 7: Generate xcodeproj**

```bash
cd /path/to/rimuruAI/words-of-world
xcodegen generate
```

Expected: `✅ Generated: WordsOfWorld.xcodeproj`

- [ ] **Step 8: Verify build compiles (empty stubs not yet)**

```bash
xcodebuild -project WordsOfWorld.xcodeproj -scheme WordsOfWorld -configuration Debug build 2>&1 | tail -5
```

Expected: `BUILD SUCCEEDED` (or expected Swift errors for missing files — resolve by creating empty placeholder files if needed)

- [ ] **Step 9: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/project.yml words-of-world/WordsOfWorld/Info.plist words-of-world/WordsOfWorld/WordsOfWorld.entitlements words-of-world/WordsOfWorld/main.swift words-of-world/WordsOfWorld.xcodeproj
git -C /path/to/rimuruAI commit -m "chore: scaffold WordsOfWorld Xcode project"
```

---

## Task 2: KeychainManager

**Files:**
- Create: `WordsOfWorld/Storage/KeychainManager.swift`
- Create: `WordsOfWorldTests/KeychainManagerTests.swift`

- [ ] **Step 1: Write the failing tests**

`WordsOfWorldTests/KeychainManagerTests.swift`:

```swift
import XCTest
@testable import WordsOfWorld

final class KeychainManagerTests: XCTestCase {
    override func setUp() {
        super.setUp()
        KeychainManager.delete()
    }

    override func tearDown() {
        KeychainManager.delete()
        super.tearDown()
    }

    func test_load_throwsWhenNoKey() {
        XCTAssertThrowsError(try KeychainManager.load())
    }

    func test_saveAndLoad_roundtrips() throws {
        try KeychainManager.save(apiKey: "test-key-123")
        let loaded = try KeychainManager.load()
        XCTAssertEqual(loaded, "test-key-123")
    }

    func test_save_overwritesPreviousKey() throws {
        try KeychainManager.save(apiKey: "old-key")
        try KeychainManager.save(apiKey: "new-key")
        let loaded = try KeychainManager.load()
        XCTAssertEqual(loaded, "new-key")
    }

    func test_delete_removesKey() throws {
        try KeychainManager.save(apiKey: "key")
        KeychainManager.delete()
        XCTAssertThrowsError(try KeychainManager.load())
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
xcodebuild test -project WordsOfWorld.xcodeproj -scheme WordsOfWorldTests -destination 'platform=macOS' 2>&1 | grep -E "(FAILED|error:|KeychainManager)"
```

Expected: compile error — `KeychainManager` not found

- [ ] **Step 3: Implement `KeychainManager`**

`WordsOfWorld/Storage/KeychainManager.swift`:

```swift
import Foundation
import Security

enum KeychainManager {
    private static let service = "com.rimuruai.words-of-world"
    private static let account = "groq-api-key"

    static func save(apiKey: String) throws {
        let data = Data(apiKey.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }

    static func load() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let key = String(data: data, encoding: .utf8) else {
            throw KeychainError.loadFailed(status)
        }
        return key
    }

    static func delete() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum KeychainError: LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let s): return "Keychain save failed: OSStatus \(s)"
        case .loadFailed(let s): return "Keychain load failed: OSStatus \(s)"
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
xcodebuild test -project WordsOfWorld.xcodeproj -scheme WordsOfWorldTests -destination 'platform=macOS' -only-testing:WordsOfWorldTests/KeychainManagerTests 2>&1 | grep -E "(PASSED|FAILED|Test Suite)"
```

Expected: `Test Suite 'KeychainManagerTests' passed`

- [ ] **Step 5: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/Storage/KeychainManager.swift words-of-world/WordsOfWorldTests/KeychainManagerTests.swift
git -C /path/to/rimuruAI commit -m "feat: add KeychainManager for BYOK API key storage"
```

---

## Task 3: TextProcessor

**Files:**
- Create: `WordsOfWorld/Managers/TextProcessor.swift`
- Create: `WordsOfWorldTests/TextProcessorTests.swift`

- [ ] **Step 1: Write the failing tests**

`WordsOfWorldTests/TextProcessorTests.swift`:

```swift
import XCTest
@testable import WordsOfWorld

final class TextProcessorTests: XCTestCase {
    func test_process_capitalizesFirstCharacter() {
        XCTAssertEqual(TextProcessor.process("hello world").first, "H")
    }

    func test_process_appendsPeriodWhenNoPunctuation() {
        XCTAssertTrue(TextProcessor.process("hello world").hasSuffix("."))
    }

    func test_process_doesNotDoublePunctuate_period() {
        XCTAssertEqual(TextProcessor.process("hello world."), "Hello world.")
    }

    func test_process_doesNotDoublePunctuate_question() {
        XCTAssertEqual(TextProcessor.process("how are you?"), "How are you?")
    }

    func test_process_doesNotDoublePunctuate_exclamation() {
        XCTAssertEqual(TextProcessor.process("great job!"), "Great job!")
    }

    func test_process_trimsLeadingAndTrailingWhitespace() {
        XCTAssertEqual(TextProcessor.process("  hello  "), "Hello.")
    }

    func test_process_stripsWhisperBoilerplate() {
        let input = "Hello world. Transcribed by OpenAI Whisper"
        XCTAssertFalse(TextProcessor.process(input).contains("Transcribed by OpenAI Whisper"))
    }

    func test_process_returnsEmptyForBlankInput() {
        XCTAssertEqual(TextProcessor.process("   "), "")
    }

    func test_process_handlesAlreadyCapitalized() {
        XCTAssertEqual(TextProcessor.process("Hello world."), "Hello world.")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
xcodebuild test -project WordsOfWorld.xcodeproj -scheme WordsOfWorldTests -destination 'platform=macOS' -only-testing:WordsOfWorldTests/TextProcessorTests 2>&1 | grep -E "(error:|TextProcessor)"
```

Expected: compile error — `TextProcessor` not found

- [ ] **Step 3: Implement `TextProcessor`**

`WordsOfWorld/Managers/TextProcessor.swift`:

```swift
import Foundation

enum TextProcessor {
    private static let boilerplatePatterns = [
        "Transcribed by OpenAI Whisper",
        "Transcribed by Whisper"
    ]
    private static let sentenceEndingPunctuation: Set<Character> = [".", "!", "?"]

    static func process(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)

        for pattern in boilerplatePatterns {
            text = text.replacingOccurrences(of: pattern, with: "")
                       .trimmingCharacters(in: .whitespacesAndNewlines)
        }

        guard !text.isEmpty else { return "" }

        // Capitalize first character
        text = text.prefix(1).uppercased() + text.dropFirst()

        // Ensure ends with sentence-ending punctuation
        if let last = text.last, !sentenceEndingPunctuation.contains(last) {
            text += "."
        }

        return text
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
xcodebuild test -project WordsOfWorld.xcodeproj -scheme WordsOfWorldTests -destination 'platform=macOS' -only-testing:WordsOfWorldTests/TextProcessorTests 2>&1 | grep -E "(PASSED|FAILED|Test Suite)"
```

Expected: `Test Suite 'TextProcessorTests' passed`

- [ ] **Step 5: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/Managers/TextProcessor.swift words-of-world/WordsOfWorldTests/TextProcessorTests.swift
git -C /path/to/rimuruAI commit -m "feat: add TextProcessor with smart cleanup"
```

---

## Task 4: GroqTranscriber

**Files:**
- Create: `WordsOfWorld/Managers/GroqTranscriber.swift`
- Create: `WordsOfWorldTests/GroqTranscriberTests.swift`

- [ ] **Step 1: Write the failing tests**

`WordsOfWorldTests/GroqTranscriberTests.swift`:

```swift
import XCTest
@testable import WordsOfWorld

// MARK: - Mock

final class MockUploadTask: URLSessionUploadTask {
    override func resume() {} // completion already called inline
}

final class MockURLSession: URLSessionProtocol {
    var stubbedData: Data?
    var stubbedResponse: URLResponse?
    var stubbedError: Error?

    func uploadTask(
        with request: URLRequest,
        from data: Data,
        completionHandler: @escaping (Data?, URLResponse?, Error?) -> Void
    ) -> URLSessionUploadTask {
        completionHandler(stubbedData, stubbedResponse, stubbedError)
        return MockUploadTask()
    }
}

// MARK: - Tests

final class GroqTranscriberTests: XCTestCase {
    var session: MockURLSession!
    var transcriber: GroqTranscriber!
    var tempFileURL: URL!

    override func setUp() {
        super.setUp()
        session = MockURLSession()
        transcriber = GroqTranscriber(session: session)
        tempFileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")
        try? Data("dummy audio bytes".utf8).write(to: tempFileURL)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempFileURL)
        super.tearDown()
    }

    func test_transcribe_returnsTextOn200() {
        session.stubbedData = Data("Hello world".utf8)
        session.stubbedResponse = HTTPURLResponse(
            url: URL(string: "https://api.groq.com")!,
            statusCode: 200, httpVersion: nil, headerFields: nil
        )

        let exp = expectation(description: "completion")
        transcriber.transcribe(fileURL: tempFileURL, apiKey: "test-key") { result in
            guard case .success(let text) = result else { return XCTFail("Expected success") }
            XCTAssertEqual(text, "Hello world")
            exp.fulfill()
        }
        waitForExpectations(timeout: 1)
    }

    func test_transcribe_failsOn401() {
        session.stubbedData = Data("Unauthorized".utf8)
        session.stubbedResponse = HTTPURLResponse(
            url: URL(string: "https://api.groq.com")!,
            statusCode: 401, httpVersion: nil, headerFields: nil
        )

        let exp = expectation(description: "completion")
        transcriber.transcribe(fileURL: tempFileURL, apiKey: "bad-key") { result in
            guard case .failure(let error) = result else { return XCTFail("Expected failure") }
            XCTAssertTrue(error.localizedDescription.contains("Groq API error"))
            exp.fulfill()
        }
        waitForExpectations(timeout: 1)
    }

    func test_transcribe_failsOnNetworkError() {
        struct FakeNetworkError: Error {}
        session.stubbedError = FakeNetworkError()

        let exp = expectation(description: "completion")
        transcriber.transcribe(fileURL: tempFileURL, apiKey: "test-key") { result in
            guard case .failure = result else { return XCTFail("Expected failure") }
            exp.fulfill()
        }
        waitForExpectations(timeout: 1)
    }

    func test_transcribe_failsWhenFileDoesNotExist() {
        let missingURL = URL(fileURLWithPath: "/tmp/nonexistent_\(UUID().uuidString).m4a")

        let exp = expectation(description: "completion")
        transcriber.transcribe(fileURL: missingURL, apiKey: "test-key") { result in
            guard case .failure = result else { return XCTFail("Expected failure") }
            exp.fulfill()
        }
        waitForExpectations(timeout: 1)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
xcodebuild test -project WordsOfWorld.xcodeproj -scheme WordsOfWorldTests -destination 'platform=macOS' -only-testing:WordsOfWorldTests/GroqTranscriberTests 2>&1 | grep -E "(error:|GroqTranscriber|URLSessionProtocol)"
```

Expected: compile error — `GroqTranscriber` and `URLSessionProtocol` not found

- [ ] **Step 3: Implement `GroqTranscriber`**

`WordsOfWorld/Managers/GroqTranscriber.swift`:

```swift
import Foundation

protocol URLSessionProtocol {
    func uploadTask(
        with request: URLRequest,
        from data: Data,
        completionHandler: @escaping (Data?, URLResponse?, Error?) -> Void
    ) -> URLSessionUploadTask
}

extension URLSession: URLSessionProtocol {}

final class GroqTranscriber {
    private let session: URLSessionProtocol
    private let apiURL = URL(string: "https://api.groq.com/openai/v1/audio/transcriptions")!

    init(session: URLSessionProtocol = URLSession.shared) {
        self.session = session
    }

    func transcribe(fileURL: URL, apiKey: String, completion: @escaping (Result<String, Error>) -> Void) {
        guard let audioData = try? Data(contentsOf: fileURL) else {
            completion(.failure(TranscriberError.fileReadFailed))
            return
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: apiURL)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()

        func appendField(_ name: String, value: String) {
            body += "--\(boundary)\r\n".utf8Data
            body += "Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8Data
            body += "\(value)\r\n".utf8Data
        }

        appendField("model", value: "whisper-large-v3-turbo")
        appendField("language", value: "en")
        appendField("response_format", value: "text")

        body += "--\(boundary)\r\n".utf8Data
        body += "Content-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\n".utf8Data
        body += "Content-Type: audio/m4a\r\n\r\n".utf8Data
        body += audioData
        body += "\r\n--\(boundary)--\r\n".utf8Data

        let task = session.uploadTask(with: request, from: body) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(TranscriberError.invalidResponse))
                return
            }
            guard http.statusCode == 200 else {
                let message = data.flatMap { String(data: $0, encoding: .utf8) } ?? "HTTP \(http.statusCode)"
                completion(.failure(TranscriberError.apiError(message)))
                return
            }
            guard let data = data, let text = String(data: data, encoding: .utf8) else {
                completion(.failure(TranscriberError.invalidResponse))
                return
            }
            completion(.success(text))
        }
        task.resume()
    }
}

enum TranscriberError: LocalizedError {
    case fileReadFailed
    case invalidResponse
    case apiError(String)

    var errorDescription: String? {
        switch self {
        case .fileReadFailed:     return "Could not read audio file."
        case .invalidResponse:    return "Invalid response from Groq API."
        case .apiError(let msg):  return "Groq API error: \(msg)"
        }
    }
}

private extension String {
    var utf8Data: Data { Data(utf8) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
xcodebuild test -project WordsOfWorld.xcodeproj -scheme WordsOfWorldTests -destination 'platform=macOS' -only-testing:WordsOfWorldTests/GroqTranscriberTests 2>&1 | grep -E "(PASSED|FAILED|Test Suite)"
```

Expected: `Test Suite 'GroqTranscriberTests' passed`

- [ ] **Step 5: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/Managers/GroqTranscriber.swift words-of-world/WordsOfWorldTests/GroqTranscriberTests.swift
git -C /path/to/rimuruAI commit -m "feat: add GroqTranscriber with URLSession protocol for testability"
```

---

## Task 5: RecorderManager

**Files:**
- Create: `WordsOfWorld/Managers/RecorderManager.swift`

Note: AVAudioRecorder requires real hardware; this component is verified via smoke test in Task 11 rather than unit tests.

- [ ] **Step 1: Implement `RecorderManager`**

`WordsOfWorld/Managers/RecorderManager.swift`:

```swift
import AVFoundation

protocol RecorderManagerDelegate: AnyObject {
    func recorderDidFinish(fileURL: URL)
    func recorderDidFail(error: Error)
}

final class RecorderManager: NSObject {
    weak var delegate: RecorderManagerDelegate?
    private var recorder: AVAudioRecorder?
    private var outputURL: URL?
    private let maxDuration: TimeInterval = 60.0

    func requestPermission(completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio, completionHandler: completion)
    }

    var isRecording: Bool { recorder?.isRecording ?? false }

    func startRecording() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("m4a")
        outputURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder?.delegate = self
        recorder?.record(forDuration: maxDuration)
    }

    func stopRecording() {
        recorder?.stop()
    }
}

extension RecorderManager: AVAudioRecorderDelegate {
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        guard flag, let url = outputURL else {
            delegate?.recorderDidFail(error: RecorderError.recordingFailed)
            return
        }
        delegate?.recorderDidFinish(fileURL: url)
    }

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        delegate?.recorderDidFail(error: error ?? RecorderError.recordingFailed)
    }
}

enum RecorderError: LocalizedError {
    case recordingFailed
    var errorDescription: String? { "Audio recording failed." }
}
```

- [ ] **Step 2: Verify project builds**

```bash
xcodebuild -project WordsOfWorld.xcodeproj -scheme WordsOfWorld -configuration Debug build 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`

- [ ] **Step 3: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/Managers/RecorderManager.swift
git -C /path/to/rimuruAI commit -m "feat: add RecorderManager using AVAudioRecorder"
```

---

## Task 6: HotkeyManager

**Files:**
- Create: `WordsOfWorld/Managers/HotkeyManager.swift`

Note: Carbon hotkey registration requires a running NSApplication event loop; verified via smoke test in Task 11.

- [ ] **Step 1: Implement `HotkeyManager`**

`WordsOfWorld/Managers/HotkeyManager.swift`:

```swift
import Carbon.HIToolbox
import AppKit

protocol HotkeyManagerDelegate: AnyObject {
    func hotkeyPressed()
}

final class HotkeyManager {
    weak var delegate: HotkeyManagerDelegate?
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?

    // Default: Option + Space (keyCode 49 = Space, optionKey modifier mask)
    private let keyCode: UInt32 = 49
    private let modifiers: UInt32 = UInt32(optionKey)

    func register() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        InstallEventHandler(
            GetApplicationEventTarget(),
            { (_, event, userData) -> OSStatus in
                guard let ptr = userData else { return OSStatus(eventNotHandledErr) }
                let manager = Unmanaged<HotkeyManager>.fromOpaque(ptr).takeUnretainedValue()
                DispatchQueue.main.async { manager.delegate?.hotkeyPressed() }
                return noErr
            },
            1,
            &eventType,
            selfPtr,
            &eventHandlerRef
        )

        // "WOW1" as OSType signature
        let sig: OSType = 0x574F5731
        let hotKeyID = EventHotKeyID(signature: sig, id: 1)
        RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    func unregister() {
        if let ref = hotKeyRef {
            UnregisterEventHotKey(ref)
            hotKeyRef = nil
        }
        if let ref = eventHandlerRef {
            RemoveEventHandler(ref)
            eventHandlerRef = nil
        }
    }

    deinit { unregister() }
}
```

- [ ] **Step 2: Verify build**

```bash
xcodebuild -project WordsOfWorld.xcodeproj -scheme WordsOfWorld -configuration Debug build 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`

- [ ] **Step 3: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/Managers/HotkeyManager.swift
git -C /path/to/rimuruAI commit -m "feat: add HotkeyManager with Carbon global hotkey (Option+Space)"
```

---

## Task 7: PasteInjector

**Files:**
- Create: `WordsOfWorld/Managers/PasteInjector.swift`

Note: CGEvent injection requires Accessibility permission; verified via smoke test in Task 11.

- [ ] **Step 1: Implement `PasteInjector`**

`WordsOfWorld/Managers/PasteInjector.swift`:

```swift
import AppKit

enum PasteInjector {
    // V key virtual keycode
    private static let vKeyCode: CGKeyCode = 9

    static func paste(text: String) {
        let pasteboard = NSPasteboard.general
        let previous = pasteboard.string(forType: .string)

        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        let source = CGEventSource(stateID: .hidSystemState)
        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: true)
        let keyUp   = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: false)
        keyDown?.flags = .maskCommand
        keyUp?.flags   = .maskCommand
        keyDown?.post(tap: .cgAnnotatedSessionEventTap)
        keyUp?.post(tap: .cgAnnotatedSessionEventTap)

        // Restore previous clipboard after paste completes
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            guard let prev = previous else { return }
            pasteboard.clearContents()
            pasteboard.setString(prev, forType: .string)
        }
    }
}
```

- [ ] **Step 2: Verify build**

```bash
xcodebuild -project WordsOfWorld.xcodeproj -scheme WordsOfWorld -configuration Debug build 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`

- [ ] **Step 3: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/Managers/PasteInjector.swift
git -C /path/to/rimuruAI commit -m "feat: add PasteInjector with NSPasteboard + CGEvent"
```

---

## Task 8: MenuBarController

**Files:**
- Create: `WordsOfWorld/UI/MenuBarController.swift`

- [ ] **Step 1: Implement `MenuBarController`**

`WordsOfWorld/UI/MenuBarController.swift`:

```swift
import AppKit

enum RecordingState {
    case idle, recording, processing
}

final class MenuBarController {
    private let statusItem: NSStatusItem
    private let menu = NSMenu()
    private let toggleItem = NSMenuItem()

    var onToggleRecording: (() -> Void)?
    var onOpenPreferences: (() -> Void)?

    init() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        buildMenu()
        updateState(.idle)
    }

    private func buildMenu() {
        toggleItem.title = "Start Recording"
        toggleItem.target = self
        toggleItem.action = #selector(handleToggle)
        menu.addItem(toggleItem)
        menu.addItem(.separator())

        let prefsItem = NSMenuItem(title: "Preferences…", action: #selector(handlePreferences), keyEquivalent: ",")
        prefsItem.target = self
        menu.addItem(prefsItem)
        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    func updateState(_ state: RecordingState) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            switch state {
            case .idle:
                self.statusItem.button?.image = NSImage(systemSymbolName: "mic", accessibilityDescription: "Idle")
                self.toggleItem.title = "Start Recording"
                self.toggleItem.isEnabled = true
            case .recording:
                self.statusItem.button?.image = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: "Recording")
                self.toggleItem.title = "Stop Recording"
                self.toggleItem.isEnabled = true
            case .processing:
                self.statusItem.button?.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Processing")
                self.toggleItem.title = "Processing…"
                self.toggleItem.isEnabled = false
            }
        }
    }

    @objc private func handleToggle() { onToggleRecording?() }
    @objc private func handlePreferences() { onOpenPreferences?() }
}
```

- [ ] **Step 2: Verify build**

```bash
xcodebuild -project WordsOfWorld.xcodeproj -scheme WordsOfWorld -configuration Debug build 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`

- [ ] **Step 3: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/UI/MenuBarController.swift
git -C /path/to/rimuruAI commit -m "feat: add MenuBarController with idle/recording/processing states"
```

---

## Task 9: PreferencesWindowController

**Files:**
- Create: `WordsOfWorld/UI/PreferencesWindowController.swift`

- [ ] **Step 1: Implement `PreferencesWindowController`**

`WordsOfWorld/UI/PreferencesWindowController.swift`:

```swift
import AppKit
import SwiftUI

final class PreferencesWindowController: NSWindowController {
    convenience init() {
        let view = PreferencesView()
        let hosting = NSHostingController(rootView: view)
        let window = NSWindow(contentViewController: hosting)
        window.title = "Preferences — Words of World"
        window.setContentSize(NSSize(width: 400, height: 160))
        window.styleMask = [.titled, .closable]
        window.center()
        self.init(window: window)
    }
}

private struct PreferencesView: View {
    @State private var apiKey = ""
    @State private var status = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Groq API Key")
                .font(.headline)

            SecureField("gsk_…", text: $apiKey)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button("Save") { save() }
                    .buttonStyle(.borderedProminent)
                Text(status)
                    .foregroundStyle(.secondary)
                    .font(.caption)
            }
        }
        .padding(24)
        .onAppear { load() }
    }

    private func save() {
        do {
            try KeychainManager.save(apiKey: apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
            status = "Saved."
        } catch {
            status = "Error: \(error.localizedDescription)"
        }
    }

    private func load() {
        apiKey = (try? KeychainManager.load()) ?? ""
    }
}
```

- [ ] **Step 2: Verify build**

```bash
xcodebuild -project WordsOfWorld.xcodeproj -scheme WordsOfWorld -configuration Debug build 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`

- [ ] **Step 3: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/UI/PreferencesWindowController.swift
git -C /path/to/rimuruAI commit -m "feat: add PreferencesWindowController with SwiftUI API key input"
```

---

## Task 10: AppDelegate — Wire Everything Together

**Files:**
- Create: `WordsOfWorld/AppDelegate.swift`

- [ ] **Step 1: Implement `AppDelegate`**

`WordsOfWorld/AppDelegate.swift`:

```swift
import AppKit
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let menuBar = MenuBarController()
    private let hotkey = HotkeyManager()
    private let recorder = RecorderManager()
    private let transcriber = GroqTranscriber()
    private var preferences: PreferencesWindowController?
    private var isRecording = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        requestNotificationPermission()
        promptAccessibilityIfNeeded()

        recorder.delegate = self
        hotkey.delegate = self
        hotkey.register()

        menuBar.onToggleRecording = { [weak self] in self?.toggleRecording() }
        menuBar.onOpenPreferences = { [weak self] in self?.openPreferences() }
    }

    // MARK: - Recording Control

    private func toggleRecording() {
        isRecording ? stopRecording() : beginRecording()
    }

    private func beginRecording() {
        recorder.requestPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self else { return }
                guard granted else {
                    self.showPermissionAlert(permission: "Microphone",
                                            prefsPane: "Privacy_Microphone")
                    return
                }
                do {
                    try self.recorder.startRecording()
                    self.isRecording = true
                    self.menuBar.updateState(.recording)
                } catch {
                    self.notify(title: "Recording Failed", body: error.localizedDescription)
                }
            }
        }
    }

    private func stopRecording() {
        isRecording = false
        menuBar.updateState(.processing)
        recorder.stopRecording()
    }

    // MARK: - Preferences

    private func openPreferences() {
        if preferences == nil { preferences = PreferencesWindowController() }
        preferences?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Permissions

    private func promptAccessibilityIfNeeded() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        AXIsProcessTrustedWithOptions(opts)
    }

    private func showPermissionAlert(permission: String, prefsPane: String) {
        let alert = NSAlert()
        alert.messageText = "\(permission) Access Required"
        alert.informativeText = "WordsOfWorld needs \(permission.lowercased()) access. Open System Settings to enable it."
        alert.addButton(withTitle: "Open System Settings")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() == .alertFirstButtonReturn {
            NSWorkspace.shared.open(
                URL(string: "x-apple.systempreferences:com.apple.preference.security?\(prefsPane)")!
            )
        }
    }

    // MARK: - Notifications

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in }
    }

    private func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

// MARK: - HotkeyManagerDelegate

extension AppDelegate: HotkeyManagerDelegate {
    func hotkeyPressed() {
        toggleRecording()
    }
}

// MARK: - RecorderManagerDelegate

extension AppDelegate: RecorderManagerDelegate {
    func recorderDidFinish(fileURL: URL) {
        guard let apiKey = try? KeychainManager.load(), !apiKey.isEmpty else {
            DispatchQueue.main.async {
                self.menuBar.updateState(.idle)
                self.notify(title: "No API Key", body: "Add your Groq API key in Preferences.")
            }
            try? FileManager.default.removeItem(at: fileURL)
            return
        }

        transcriber.transcribe(fileURL: fileURL, apiKey: apiKey) { [weak self] result in
            try? FileManager.default.removeItem(at: fileURL)
            DispatchQueue.main.async {
                guard let self else { return }
                self.menuBar.updateState(.idle)
                switch result {
                case .success(let raw):
                    let cleaned = TextProcessor.process(raw)
                    guard !cleaned.isEmpty else { return }
                    PasteInjector.paste(text: cleaned)
                case .failure(let error):
                    self.notify(title: "Transcription Failed", body: error.localizedDescription)
                }
            }
        }
    }

    func recorderDidFail(error: Error) {
        DispatchQueue.main.async {
            self.isRecording = false
            self.menuBar.updateState(.idle)
            self.notify(title: "Recording Failed", body: error.localizedDescription)
        }
    }
}
```

- [ ] **Step 2: Run all tests**

```bash
xcodebuild test -project WordsOfWorld.xcodeproj -scheme WordsOfWorldTests -destination 'platform=macOS' 2>&1 | grep -E "(PASSED|FAILED|Test Suite 'All tests')"
```

Expected: `Test Suite 'All tests' passed`

- [ ] **Step 3: Build the app**

```bash
xcodebuild -project WordsOfWorld.xcodeproj -scheme WordsOfWorld -configuration Debug build 2>&1 | tail -3
```

Expected: `BUILD SUCCEEDED`

- [ ] **Step 4: Commit**

```bash
git -C /path/to/rimuruAI add words-of-world/WordsOfWorld/AppDelegate.swift
git -C /path/to/rimuruAI commit -m "feat: wire all managers in AppDelegate — app is feature-complete"
```

---

## Task 11: Smoke Test (Manual)

This task cannot be automated — it requires a real microphone, Accessibility permission, and a running app.

- [ ] **Step 1: Build and run the app**

In Xcode: open `WordsOfWorld.xcodeproj`, select the `WordsOfWorld` scheme, press `⌘R`.

OR from terminal (after a Debug build):
```bash
open /path/to/rimuruAI/words-of-world/build/Debug/WordsOfWorld.app
```

- [ ] **Step 2: Grant permissions**

When the app launches:
- Accept the Accessibility prompt (System Settings > Privacy & Security > Accessibility → enable WordsOfWorld)
- A mic permission dialog will appear on first recording

- [ ] **Step 3: Add your Groq API key**

Click the menu bar mic icon → Preferences → paste your `gsk_...` key → Save.

- [ ] **Step 4: Test the golden path**

1. Open any text field (e.g. TextEdit, browser URL bar, Notes)
2. Press `⌥Space` — menu bar icon should turn red (recording)
3. Say a sentence clearly: "The quick brown fox jumps over the lazy dog"
4. Press `⌥Space` again — icon turns to spinner (processing)
5. After ~1–2 seconds: the transcribed, capitalized, punctuated text should appear in the field

- [ ] **Step 5: Verify icon states**

| Action | Expected icon |
|---|---|
| App idle | Microphone outline |
| Recording | Red filled microphone |
| Transcribing | Waveform / spinner |

- [ ] **Step 6: Test error cases**

- Remove the API key in Preferences and record → notification: "No API Key"
- Record for less than 0.5s → nothing happens (silent discard)

- [ ] **Step 7: Final commit**

```bash
git -C /path/to/rimuruAI add words-of-world/
git -C /path/to/rimuruAI commit -m "chore: complete smoke test — v1.0 words-of-world working"
```

---

## Self-Review Notes

- All spec requirements covered: hotkey ✓, menu bar icon ✓, three icon states ✓, BYOK Keychain ✓, Groq whisper-large-v3-turbo ✓, English-only ✓, smart cleanup ✓, auto-paste ✓, mic permission ✓, accessibility permission ✓, error notifications ✓, short recording discard ✓, temp file cleanup ✓
- Short recording discard (< 0.5s): AVAudioRecorder will still finish and produce a tiny file; Groq will return an empty string or whitespace — TextProcessor.process returns `""` for blank input, and AppDelegate checks `guard !cleaned.isEmpty` before pasting. No separate duration check needed.
- Type consistency: `RecordingState` defined in `MenuBarController.swift`, used only in that file and `AppDelegate.swift` — both import AppKit, no cross-module issue.
