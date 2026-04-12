import Foundation

/// Stores the Groq API key as a 0600-permission file in
/// ~/Library/Application Support/com.rimuruai.words-of-world/.
/// This avoids macOS Keychain access prompts that appear every launch
/// when the binary is unsigned, while still restricting the file to
/// the owning user account — the same model SSH private keys use.
enum KeychainManager {
    private static let storageDirectory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("com.rimuruai.words-of-world", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private static var keyFile: URL {
        storageDirectory.appendingPathComponent("api_key")
    }

    static func save(apiKey: String) throws {
        let data = Data(apiKey.utf8)
        try data.write(to: keyFile, options: .atomic)
        // Restrict to owner read/write only (chmod 600)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: 0o600)],
            ofItemAtPath: keyFile.path
        )
    }

    static func load() throws -> String {
        guard FileManager.default.fileExists(atPath: keyFile.path) else {
            throw KeychainError.loadFailed(-1)
        }
        let data = try Data(contentsOf: keyFile)
        guard let key = String(data: data, encoding: .utf8), !key.isEmpty else {
            throw KeychainError.loadFailed(-2)
        }
        return key
    }

    static func delete() {
        try? FileManager.default.removeItem(at: keyFile)
    }
}

enum KeychainError: LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let s): return "Failed to save API key (code \(s))"
        case .loadFailed(let s): return "API key not found — open Preferences to set it (code \(s))"
        }
    }
}
