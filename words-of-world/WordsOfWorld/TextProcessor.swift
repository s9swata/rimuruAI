import Foundation

enum TextProcessor {
    private static let boilerplatePatterns = [
        "Transcribed by OpenAI Whisper",
        "Transcribed by whisper",
        "Whisper transcription",
        "Transcribed by"
    ]

    static func process(_ text: String) -> String {
        var processed = text

        for pattern in boilerplatePatterns {
            processed = processed.replacingOccurrences(of: pattern, with: "", options: .caseInsensitive)
        }

        processed = processed.trimmingCharacters(in: .whitespacesAndNewlines)

        if let first = processed.first, first.isLowercase {
            processed = processed.replacingCharacters(in: processed.startIndex...processed.startIndex, with: String(first).uppercased())
        }

        if let last = processed.last, last.isLetter || last.isNumber {
            processed.append(".")
        }

        return processed
    }
}