import Foundation

enum GroqTranscriber {
    private static let endpoint = URL(string: "https://api.groq.com/openai/v1/audio/transcriptions")!
    private static let boundary = UUID().uuidString

    static func transcribe(audioData: Data, fileName: String = "audio.m4a") async throws -> String {
        let apiKey = try KeychainManager.load()

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let body = createMultipartBody(audioData: audioData, fileName: fileName)
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw TranscriberError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorResponse = try? JSONDecoder().decode(GroqErrorResponse.self, from: data) {
                throw TranscriberError.apiError(errorResponse.error.message)
            }
            throw TranscriberError.httpError(httpResponse.statusCode)
        }

        let transcription = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        
        guard let result = transcription, !result.isEmpty else {
            throw TranscriberError.emptyResponse
        }

        return result
    }

    private static func createMultipartBody(audioData: Data, fileName: String) -> Data {
        var body = Data()

        func addField(_ name: String, value: String) {
            let part = "--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n"
            body.append(part.data(using: .utf8)!)
        }

        addField("model", value: "whisper-large-v3-turbo")
        addField("language", value: "en")
        addField("response_format", value: "text")

        let fileHeader = "--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: audio/m4a\r\n\r\n"
        body.append(fileHeader.data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        return body
    }
}

enum TranscriberError: LocalizedError {
    case invalidResponse
    case httpError(Int)
    case apiError(String)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let code):
            return "HTTP error: \(code)"
        case .apiError(let message):
            return "API error: \(message)"
        case .emptyResponse:
            return "Empty transcription response"
        }
    }
}

private struct GroqErrorResponse: Decodable {
    let error: GroqErrorDetail
}

private struct GroqErrorDetail: Decodable {
    let message: String
}