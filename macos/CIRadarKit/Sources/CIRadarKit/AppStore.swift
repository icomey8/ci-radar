import Foundation
import Observation
import os

/// All of the app's state, and the only thing that talks to the API.
@Observable @MainActor
public final class AppStore {
  public private(set) var repos: LoadState<[Repo]> = .idle
  public private(set) var selectedRepoID: Repo.ID?
  /// The selected repo's ranking; there's no cache for the others.
  public private(set) var ranking: LoadState<Ranking> = .idle
  /// Whether a refresh is running. The data already on screen stays there meanwhile.
  public private(set) var isRefreshing = false

  @ObservationIgnored private let api: any CIRadarAPI
  @ObservationIgnored private let logger = Logger(subsystem: "dev.ciradar.CIRadar", category: "AppStore")
  /// Counts ranking loads, so only the newest one writes its result.
  @ObservationIgnored private var rankingLoads = 0

  public init(api: any CIRadarAPI) {
    self.api = api
  }

  /// Fetches the repo list, then the selected repo's ranking, keeping whatever is on screen
  /// until the new data arrives. Selects the first repo if nothing (or a repo that's gone) was selected.
  /// Does nothing while another refresh is running, so launch, activation and ⌘R can't pile up.
  public func refresh() async {
    guard !isRefreshing else { return }
    isRefreshing = true
    defer { isRefreshing = false }

    guard await loadRepos() else { return }
    await loadRanking()
  }

  /// Selects a repo and loads its ranking. The selection changes before the first suspension, so
  /// a caller that starts this with `Task.immediate` sees it change at once. Re-selecting the
  /// current repo does nothing.
  public func select(_ id: Repo.ID?) async {
    guard id != selectedRepoID else { return }
    selectedRepoID = id
    await loadRanking()
  }

  /// Loads the repo list, selecting the first repo if the selected one isn't in it.
  /// Returns whether it loaded.
  private func loadRepos() async -> Bool {
    if repos.value == nil {
      repos = .loading
    }
    let list: [Repo]
    do {
      list = try await api.repos()
    } catch {
      logger.error("Loading repos failed: \(String(describing: error), privacy: .public)")
      repos = .failed(error)
      return false
    }
    logger.info("Loaded \(list.count) repos")
    repos = .loaded(list)
    if !list.contains(where: { $0.id == selectedRepoID }) {
      selectedRepoID = list.first?.id
    }
    return true
  }

  /// Loads the selected repo's ranking. A load overtaken by a newer one drops its result, so a
  /// slow answer for a repo that's no longer selected can't replace the current one.
  ///
  /// A 404 `repo_not_found` means the repo stopped being watched, so the list is reloaded (selecting
  /// another repo) instead of showing an error. That happens once: if the list still names the
  /// repo, the second 404 is shown.
  private func loadRanking(reloadingListIfGone: Bool = true) async {
    rankingLoads += 1
    let load = rankingLoads
    guard let id = selectedRepoID else {
      ranking = .idle
      return
    }
    // Refreshing the repo on screen keeps it there; switching repos shows the loading state.
    if ranking.value?.repo.id != id {
      ranking = .loading
    }

    let result: LoadState<Ranking>
    do {
      let loaded = try await api.ranking(repoID: id)
      logger.info("Loaded ranking for repo \(id): \(loaded.flaky.count) flaky, \(loaded.broken.count) broken")
      result = .loaded(loaded)
    } catch .server(404, "repo_not_found", _) where reloadingListIfGone {
      guard load == rankingLoads else { return }
      logger.info("Repo \(id) is no longer watched; reloading the repo list")
      guard await loadRepos() else { return }
      await loadRanking(reloadingListIfGone: false)
      return
    } catch {
      logger.error("Loading ranking for repo \(id) failed: \(String(describing: error), privacy: .public)")
      result = .failed(error)
    }
    guard load == rankingLoads else { return }
    ranking = result
  }
}
