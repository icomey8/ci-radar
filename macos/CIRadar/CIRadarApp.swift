import CIRadarKit
import SwiftUI

@main
struct CIRadarApp: App {
  private let apiBaseURL: URL
  @State private var store: AppStore

  init() {
    let apiBaseURL = Configuration.apiBaseURL()
    self.apiBaseURL = apiBaseURL
    _store = State(initialValue: AppStore(api: LiveAPI(baseURL: apiBaseURL)))
  }

  var body: some Scene {
    WindowGroup {
      ContentView(store: store, apiBaseURL: apiBaseURL)
        .frame(minWidth: 760, minHeight: 480)
    }
  }
}
