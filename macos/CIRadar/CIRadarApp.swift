import CIRadarKit
import SwiftUI

@main
struct CIRadarApp: App {
  @State private var store = AppStore(api: LiveAPI(baseURL: Configuration.apiBaseURL()))

  var body: some Scene {
    WindowGroup {
      ContentView(store: store)
        .frame(minWidth: 760, minHeight: 480)
    }
  }
}
