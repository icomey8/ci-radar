// swift-tools-version: 6.2
import PackageDescription

let swiftSettings: [SwiftSetting] = [
  .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
  .enableUpcomingFeature("InferIsolatedConformances"),
]

let package = Package(
  name: "CIRadarKit",
  platforms: [.macOS(.v26)],
  products: [
    .library(name: "CIRadarKit", targets: ["CIRadarKit"])
  ],
  targets: [
    .target(
      name: "CIRadarKit",
      resources: [.copy("Fixtures")],
      swiftSettings: swiftSettings
    ),
    .testTarget(
      name: "CIRadarKitTests",
      dependencies: ["CIRadarKit"],
      swiftSettings: swiftSettings
    ),
  ],
  swiftLanguageModes: [.v6]
)
