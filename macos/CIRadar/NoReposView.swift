import SwiftUI

/// The detail pane when the user watches no repos yet.
struct NoReposView: View {
  let refresh: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label("No watched repos", systemImage: "binoculars")
    } description: {
      Text("Add one from the terminal with `pnpm add-repo owner/name`, then refresh.")
    } actions: {
      Button("Refresh", action: refresh)
    }
  }
}

#Preview {
  NoReposView(refresh: {})
    .frame(width: 500, height: 480)
}
