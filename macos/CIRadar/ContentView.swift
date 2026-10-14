import CIRadarKit
import SwiftUI

struct ContentView: View {
  @Bindable var store: AppStore
  let apiBaseURL: URL

  var body: some View {
    Group {
      if case .failed(let error) = store.repos {
        UnreachableView(error: error, apiBaseURL: apiBaseURL) {
          Task { await store.refresh() }
        }
      } else {
        NavigationSplitView {
          sidebar
            .navigationSplitViewColumnWidth(min: 220, ideal: 260)
        } detail: {
          detail
        }
      }
    }
    .task { await store.refresh() }
  }

  @ViewBuilder private var sidebar: some View {
    if let repos = store.repos.value {
      List(repos, selection: $store.selectedRepoID) { repo in
        RepoRow(repo: repo)
      }
    } else {
      ProgressView()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  @ViewBuilder private var detail: some View {
    if let repo = store.repos.value?.first(where: { $0.id == store.selectedRepoID }) {
      Text(repo.fullName)
        .font(.title2.weight(.semibold))
    }
  }
}
