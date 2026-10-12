import CIRadarKit
import SwiftUI

struct ContentView: View {
  @Bindable var store: AppStore

  var body: some View {
    NavigationSplitView {
      sidebar
        .navigationSplitViewColumnWidth(min: 220, ideal: 260)
    } detail: {
      detail
    }
    .task { await store.refresh() }
  }

  @ViewBuilder private var sidebar: some View {
    switch store.repos {
    case .idle, .loading:
      ProgressView()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    case .loaded(let repos):
      List(repos, selection: $store.selectedRepoID) { repo in
        RepoRow(repo: repo)
      }
    case .failed:
      Color.clear
    }
  }

  @ViewBuilder private var detail: some View {
    switch store.repos {
    case .failed(let error):
      ContentUnavailableView(
        "Can't reach CI Radar", systemImage: "bolt.horizontal.circle",
        description: Text(String(describing: error)))
    case .loaded(let repos):
      if let repo = repos.first(where: { $0.id == store.selectedRepoID }) {
        Text(repo.fullName)
          .font(.title2.weight(.semibold))
      }
    case .idle, .loading:
      EmptyView()
    }
  }
}
