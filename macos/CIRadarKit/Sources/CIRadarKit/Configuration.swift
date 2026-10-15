import Foundation

public enum Configuration {
  public static let defaultAPIBaseURL = URL(string: "http://localhost:8787")!

  /// The API base URL: the `-apiBaseURL <url>` launch argument if given, else localhost:8787.
  public static func apiBaseURL(from defaults: UserDefaults = .standard) -> URL {
    defaults.string(forKey: "apiBaseURL").flatMap(URL.init(string:)) ?? defaultAPIBaseURL
  }

  /// The `-fixtureScenario <name>` launch argument, if given. Only DEBUG builds of the app read it (spec §7.4).
  public static func fixtureScenarioName(from defaults: UserDefaults = .standard) -> String? {
    defaults.string(forKey: "fixtureScenario")
  }
}
