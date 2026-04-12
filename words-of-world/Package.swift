// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "WordsOfWorld",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "WordsOfWorld",
            path: "WordsOfWorld",
            linkerSettings: [
                .linkedFramework("Carbon"),
                .linkedFramework("UserNotifications")
            ]
        ),
        .testTarget(
            name: "WordsOfWorldTests",
            dependencies: ["WordsOfWorld"],
            path: "WordsOfWorldTests"
        )
    ]
)
