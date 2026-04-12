// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "WordsOfWorld",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "WordsOfWorld",
            path: "WordsOfWorld",
            exclude: ["Info.plist", "WordsOfWorld.entitlements"],
            linkerSettings: [
                .linkedFramework("Carbon"),
                .linkedFramework("UserNotifications")
            ]
        ),
        .testTarget(
            name: "WordsOfWorldTests",
            dependencies: ["WordsOfWorld"],
            path: "WordsOfWorldTests",
            swiftSettings: [
                .unsafeFlags([
                    "-F", "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"
                ])
            ]
        )
    ]
)
