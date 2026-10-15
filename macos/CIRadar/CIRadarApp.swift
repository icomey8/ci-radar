import CIRadarKit
import SwiftUI

@main
struct CIRadarApp: App {
  private let apiBaseURL: URL
  @State private var store: AppStore

  init() {
    let apiBaseURL = Configuration.apiBaseURL()
    self.apiBaseURL = apiBaseURL
    _store = State(initialValue: AppStore(api: Self.makeAPI(baseURL: apiBaseURL)))
  }

  /// The live API, unless a DEBUG build was launched with `-fixtureScenario <name>` (spec §7.4).
  private static func makeAPI(baseURL: URL) -> any CIRadarAPI {
    #if DEBUG
      if let name = Configuration.fixtureScenarioName() {
        guard let scenario = FixtureAPI.Scenario(rawValue: name) else {
          let known = FixtureAPI.Scenario.allCases.map(\.rawValue).joined(separator: ", ")
          fatalError("Unknown -fixtureScenario \"\(name)\"; expected one of: \(known)")
        }
        return FixtureAPI(scenario: scenario)
      }
    #endif
    return LiveAPI(baseURL: baseURL)
  }

  var body: some Scene {
    WindowGroup {
      ContentView(store: store, apiBaseURL: apiBaseURL)
        .frame(minWidth: 760, minHeight: 480)
    }
  }
}
