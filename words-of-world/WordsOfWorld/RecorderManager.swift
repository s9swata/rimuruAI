import Foundation
import AVFoundation
import Accelerate

enum RecorderManager {
    private static let audioEngine = AVAudioEngine()
    private static var audioFile: AVAudioFile?
    private static var recordingURL: URL?
    private static var isRecording = false
    private static var timeoutTimer: Timer?
    private static let maxRecordingDuration: TimeInterval = 60.0
    
    // Voice Activity Detection state machine (similar to rhasspy-silence)
    private enum VADState {
        case idle
        case speechStarted
        case voiceCommand
    }
    
    private static var vadState: VADState = .idle
    private static var silenceCounter: TimeInterval = 0
    private static var speechCounter: TimeInterval = 0
    private static var voiceActivityDetected = false
    
    // VAD parameters (similar to rhasspy-silence)
    private static let vadThresholdDb: Float = -45.0
    private static let speechSecondsRequired: TimeInterval = 0.3   // 300ms of speech to start
    private static let silenceSecondsRequired: TimeInterval = 0.5   // 500ms of silence to end
    
    static func hasSignificantAudio() -> Bool {
        return voiceActivityDetected
    }
    
    static func resetVAD() {
        vadState = .idle
        silenceCounter = 0
        speechCounter = 0
        voiceActivityDetected = false
    }

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
                updateVAD(buffer: buffer)
            } catch {
                print("Failed to write audio buffer: \(error)")
            }
        }
        
        try audioEngine.start()
        isRecording = true
        resetVAD()
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
    
    private static func updateVAD(buffer: AVAudioPCMBuffer) {
        let db = calculateDb(buffer: buffer)
        
        guard db.isFinite else { return }
        
        let isSpeech = db > vadThresholdDb
        let bufferDuration = Double(buffer.frameLength) / buffer.format.sampleRate
        
        NSLog("[WordsOfWorld] VAD: \(String(format: "%.1f", db)) dB, speech: \(isSpeech), state: \(vadState), voiceDetected: \(voiceActivityDetected)")
        
        switch vadState {
        case .idle:
            if isSpeech {
                speechCounter += bufferDuration
                if speechCounter >= speechSecondsRequired {
                    vadState = .voiceCommand
                    voiceActivityDetected = true
                    NSLog("[WordsOfWorld] Voice command started - speech detected")
                }
            } else {
                speechCounter = 0
            }
            
        case .voiceCommand:
            if isSpeech {
                silenceCounter = 0
            } else {
                silenceCounter += bufferDuration
                if silenceCounter >= silenceSecondsRequired {
                    NSLog("[WordsOfWorld] Voice command ended - silence detected")
                    vadState = .idle
                }
            }
            
        case .speechStarted:
            if isSpeech {
                speechCounter += bufferDuration
                if speechCounter >= speechSecondsRequired {
                    vadState = .voiceCommand
                    voiceActivityDetected = true
                }
            } else {
                speechCounter = 0
                vadState = .idle
            }
        }
    }
    
    private static func calculateDb(buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData else { return -Float.infinity }
        
        let frameLength = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        
        guard frameLength > 0 && channelCount > 0 else { return -Float.infinity }
        
        var rms: Float = 0
        for channel in 0..<channelCount {
            var sum: Float = 0
            vDSP_sve(channelData[channel], 1, &sum, vDSP_Length(frameLength))
            let meanSquare = sum / Float(frameLength)
            rms += meanSquare
        }
        rms = sqrt(rms / Float(channelCount))
        
        guard rms > 0 else { return -Float.infinity }
        return 20 * log10(rms)
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