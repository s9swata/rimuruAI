import Testing
@testable import WordsOfWorld

@Suite(.serialized)
struct KeychainManagerTests: ~Copyable {
    init() { KeychainManager.delete() }
    deinit { KeychainManager.delete() }

    @Test func throwsWhenNoKey() {
        #expect(throws: (any Error).self) {
            try KeychainManager.load()
        }
    }

    @Test func saveAndLoadRoundtrips() throws {
        try KeychainManager.save(apiKey: "test-key-123")
        let loaded = try KeychainManager.load()
        #expect(loaded == "test-key-123")
    }

    @Test func saveOverwritesPreviousKey() throws {
        try KeychainManager.save(apiKey: "old-key")
        try KeychainManager.save(apiKey: "new-key")
        let loaded = try KeychainManager.load()
        #expect(loaded == "new-key")
    }

    @Test func deleteRemovesKey() throws {
        try KeychainManager.save(apiKey: "key")
        KeychainManager.delete()
        #expect(throws: (any Error).self) {
            try KeychainManager.load()
        }
    }
}
