import Foundation
import AVFoundation

enum RecorderManager {
    private static let audioEngine = AVAudioEngine()
    private static var audioFile: AVAudioFile?
    private static var recordingURL: URL?
    private static var isRecording = false
    private static var timeoutTimer: Timer?
    private static let maxRecordingDuration: TimeInterval = 60.0

    static func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    static func startRecording() async throws -> URL {
        guard !isRecording else {
            throw RecorderError.alreadyRecording
        }

        let hasPermission = await requestPermission()
        guard hasPermission else {
            throw RecorderError.permissionDenied
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        guard let url = createTemporaryURL() else {
            throw RecorderError.failedToCreateFile
        }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: recordingFormat.sampleRate,
            AVNumberOfChannelsKey: recordingFormat.channelCount,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        audioFile = try AVAudioFile(forWriting: url, settings: settings)
        recordingURL = url

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            do {
                try audioFile?.write(from: buffer)
            } catch {
                print("Failed to write audio buffer: \(error)")
            }
        }

        try audioEngine.start()
        isRecording = true
        startTimeoutTimer()

        return url
    }

    static func stopRecording() -> URL? {
        guard isRecording else {
            return nil
        }

        stopTimeoutTimer()
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
        isRecording = false
        audioFile = nil

        let url = recordingURL
        recordingURL = nil
        return url
    }

    static func currentRecordingURL() -> URL? {
        return recordingURL
    }

    static func recordingStatus() -> Bool {
        return isRecording
    }

    private static func createTemporaryURL() -> URL? {
        let tempDir = FileManager.default.temporaryDirectory
        let fileName = "recording_\(UUID().uuidString).m4a"
        return tempDir.appendingPathComponent(fileName)
    }

    private static func startTimeoutTimer() {
        DispatchQueue.main.async {
            timeoutTimer = Timer.scheduledTimer(withTimeInterval: maxRecordingDuration, repeats: false) { _ in
                _ = stopRecording()
            }
        }
    }

    private static func stopTimeoutTimer() {
        timeoutTimer?.invalidate()
        timeoutTimer = nil
    }
}

enum RecorderError: LocalizedError {
    case alreadyRecording
    case permissionDenied
    case failedToCreateFile
    case notRecording

    var errorDescription: String? {
        switch self {
        case .alreadyRecording:
            return "Recording is already in progress"
        case .permissionDenied:
            return "Microphone permission was denied"
        case .failedToCreateFile:
            return "Failed to create temporary audio file"
        case .notRecording:
            return "No recording is in progress"
        }
    }
}