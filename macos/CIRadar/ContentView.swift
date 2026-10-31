import AppKit
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
        .background(Color.paneBackground)
      } else {
        NavigationSplitView {
          sidebar
            .navigationSplitViewColumnWidth(min: 220, ideal: 260)
        } detail: {
          detail
        }
      }
    }
    // Refresh on launch and whenever the user comes back to the app (spec §5.4); overlapping
    // refreshes are dropped by the store.
    .task { await store.refresh() }
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
      Task { await store.refresh() }
    }
  }

  @ViewBuilder private var sidebar: some View {
    if let repos = store.repos.value {
      List(repos, selection: selection) { repo in
        RepoRow(repo: repo)
      }
    } else {
      // First load: rows shaped like the real ones, redacted.
      List(Self.placeholderRepos) { repo in
        RepoRow(repo: repo)
      }
      .redacted(reason: .placeholder)
      .disabled(true)
    }
  }

  private static let placeholderRepos = [
    Repo(id: -1, owner: "owner", name: "repository", latestDataAt: .now, flakyCount: 0, brokenCount: 0),
    Repo(id: -2, owner: "owner", name: "other-repo", latestDataAt: .now, flakyCount: 0, brokenCount: 0),
    Repo(id: -3, owner: "owner", name: "service", latestDataAt: .now, flakyCount: 0, brokenCount: 0),
  ]

  /// `Task.immediate` runs `select` up to its first `await` before returning, so the selection
  /// (and the sidebar highlight) changes on the same frame as the click; the ranking follows.
  private var selection: Binding<Repo.ID?> {
    Binding(
      get: { store.selectedRepoID },
      set: { id in Task.immediate { await store.select(id) } })
  }

  @ViewBuilder private var detail: some View {
    Group {
      if store.repos.value?.isEmpty == true {
        NoReposView {
          Task { await store.refresh() }
        }
      } else {
        switch (store.repos, store.ranking) {
        case (_, .loaded(let ranking)):
          RankingView(ranking: ranking)
        case (.loading, _), (_, .loading):
          ProgressView("Loading…")
        default:
          Color.clear
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.paneBackground)
    .toolbar {
      // A refresh over data already on screen shows here; the first load fills the window instead.
      if store.isRefreshing && store.repos.value != nil {
        ProgressView()
          .controlSize(.small)
          .help("Refreshing")
      }
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

  #Preview("Loading") {
    ContentView(store: AppStore(api: FixtureAPI(scenario: .loading)), apiBaseURL: Configuration.defaultAPIBaseURL)
      .frame(width: 760, height: 480)
  }

  #Preview("No repos") {
    ContentView(store: AppStore(api: FixtureAPI(scenario: .noRepos)), apiBaseURL: Configuration.defaultAPIBaseURL)
      .frame(width: 760, height: 480)
  }

  #Preview("Unreachable") {
    ContentView(store: AppStore(api: FixtureAPI(scenario: .unreachable)), apiBaseURL: Configuration.defaultAPIBaseURL)
      .frame(width: 760, height: 480)
  }
#endif
