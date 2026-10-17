import CIRadarKit
import SwiftUI

struct ContentView: View {
  let store: AppStore
  let apiBaseURL: URL

  var body: some View {
    Group {
      // Any failure takes over the window (spec §6).
      if let error = store.repos.error ?? store.ranking.error {
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
      List(repos, selection: selection) { repo in
        RepoRow(repo: repo)
      }
    } else {
      ProgressView()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  /// `Task.immediate` runs `select` up to its first `await` before returning, so the selection
  /// (and the sidebar highlight) changes on the same frame as the click; the ranking follows.
  private var selection: Binding<Repo.ID?> {
    Binding(
      get: { store.selectedRepoID },
      set: { id in Task.immediate { await store.select(id) } })
  }

  @ViewBuilder private var detail: some View {
    Group {
      switch store.ranking {
      case .loaded(let ranking):
        RankingView(ranking: ranking)
      case .loading:
        ProgressView("Loading…")
      case .idle, .failed:
        Color.clear
      }
    }
    .toolbar {
      Button("Refresh", systemImage: "arrow.clockwise") {
        Task { await store.refresh() }
      }
      .keyboardShortcut("r")
      .help("Refresh")
    }
  }
}

// FixtureAPI only exists in DEBUG builds.
#if DEBUG
  #Preview("Ranking") {
    ContentView(store: AppStore(api: FixtureAPI(scenario: .ranking)), apiBaseURL: Configuration.defaultAPIBaseURL)
      .frame(width: 760, height: 480)
  }

  #Preview("Unreachable") {
    ContentView(store: AppStore(api: FixtureAPI(scenario: .unreachable)), apiBaseURL: Configuration.defaultAPIBaseURL)
      .frame(width: 760, height: 480)
  }
#endif
