import Foundation

/// The shared contract fixtures in `Fixtures/` (spec §7.2), which the API's tests also read.
enum Fixtures {
  static func data(named name: String) throws -> Data {
    guard let url = Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures") else {
      throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: "Fixtures/\(name)"])
    }
    return try Data(contentsOf: url)
  }
}
